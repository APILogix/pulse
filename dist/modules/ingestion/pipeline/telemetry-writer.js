/**
 * TelemetryWriter — persists normalized events into the AUTHORITATIVE analytics
 * event schema (migrations2/004): the partitioned `events_*` tables that the
 * analytics + event-analytics modules read from.
 *
 * ── Why this was rewritten ──────────────────────────────────────────────────
 * The previous implementation (preserved in telemetry-writer.legacy.ts) wrote
 * into the legacy `migrations/013-014` tables (`errors`, `requests`, `metrics`,
 * …). Those tables are outdated and are NOT queried by analytics/alerting, so
 * every ingested event was invisible downstream. This version targets the
 * `events_*` tables (`events_errors`, `events_requests`, …) keyed by
 * `organization_id` + `project_id`, so ingested data flows straight into
 * dashboards, error groups, rollups and the alerting read path.
 *
 * Design:
 *   - One multi-row INSERT per event type per batch (single round trip/type).
 *   - All writes are tenant-scoped: organization_id + project_id come from the
 *     authenticated API key, NEVER the payload (defends cross-tenant spoofing).
 *   - `timestamp` = the event time (clamped); `created_at` is left to DEFAULT
 *     NOW() because it is the DAILY PARTITION KEY — partitions are pre-created
 *     by the analytics `create_event_partitions()` job, with a DEFAULT
 *     partition catching any gap so inserts never fail.
 *   - Enum-typed columns (severity/kind/status/level) are coerced to the exact
 *     migrations2 enum domains; unknown values fall back to a safe default.
 *   - Every INSERT is idempotent: `ON CONFLICT DO NOTHING` (no column target)
 *     drops rows that hit the `(project_id, event_id) NULLS NOT DISTINCT`
 *     identity indexes (17_enterprise_ingestion/001), so at-least-once
 *     delivery (pg-boss retries, DLQ replays, SDK retries) never duplicates
 *     events. PostgreSQL's command tag keeps rowCount truthful without
 *     returning row data for non-error inserts; errors return event_id because
 *     grouping only runs for rows confirmed inserted.
 *   - Rollups (analytics_hourly_rollup / analytics_error_groups) are owned by
 *     the event-analytics worker and the ingestion event-processor, NOT
 *     written here — this writer only persists raw events.
 */
import { v7 as uuidv7 } from 'uuid';
import { generatePublicId, PUBLIC_ID_PREFIXES } from '../../../shared/utils/public-id-generator.js';
import { STATUS_CODES } from 'http';
import { LIMITS, parseSafeEpochMs, resolveTimestamp } from './event-normalizer.js';
import { RequestEnricher } from './request-enrichment.js';
import { computeErrorFingerprint, ERROR_FINGERPRINT_VERSION } from '../../errors/fingerprint.js';
import { env } from '../../../config/env.js';
function resolveScopedTimestamp(event, occurredAtMs) {
    const stable = parseSafeEpochMs(occurredAtMs);
    return stable !== null && stable > 0 ? stable : resolveTimestamp(event);
}
export function parseSafeIsoTimestamp(raw, context) {
    if (raw === null || raw === undefined || raw === '') {
        return null;
    }
    const ms = parseSafeEpochMs(raw);
    if (ms !== null && Number.isFinite(ms) && !Number.isNaN(ms)) {
        try {
            return new Date(ms).toISOString();
        }
        catch (err) {
            if (context?.logger) {
                context.logger.warn({
                    err,
                    traceId: context.traceId,
                    spanId: context.spanId,
                    field: context.field,
                    rawValue: typeof raw === 'object' ? JSON.stringify(raw) : String(raw),
                    rawType: typeof raw,
                }, 'invalid timestamp failed to convert to ISO string');
            }
            return null;
        }
    }
    if (context?.logger) {
        context.logger.warn({
            traceId: context.traceId,
            spanId: context.spanId,
            field: context.field,
            rawValue: typeof raw === 'object' ? JSON.stringify(raw) : String(raw),
            rawType: typeof raw,
        }, 'unparseable or invalid timestamp in telemetry');
    }
    return null;
}
function iso(ms) {
    if (typeof ms === 'number' && Number.isFinite(ms) && !Number.isNaN(ms)) {
        try {
            return new Date(Math.round(ms)).toISOString();
        }
        catch {
            return new Date().toISOString();
        }
    }
    const safe = parseSafeEpochMs(ms);
    if (safe !== null && Number.isFinite(safe) && !Number.isNaN(safe)) {
        try {
            return new Date(safe).toISOString();
        }
        catch {
            return new Date().toISOString();
        }
    }
    return new Date().toISOString();
}
/** Cast a normalized event to a loose record for passthrough field access. */
function rec(ev) {
    return ev;
}
/** Return the SDK metadata object while making the server-resolved environment authoritative. */
function metadataFor(ev, environment) {
    const value = rec(ev).metadata;
    const metadata = value && typeof value === 'object' && !Array.isArray(value)
        ? { ...value }
        : {};
    metadata.environment = environment;
    return metadata;
}
function metadataField(metadata, ev, key) {
    return metadata[key] ?? rec(ev)[key];
}
const REQUEST_ATTRIBUTE_DUPLICATES = new Set([
    'endpoint', 'method', 'duration_ms', 'durationMs', 'latency', 'latency_ms',
    'statusCode', 'status_code', 'responseSize', 'response_size', 'bodySize', 'body_size',
    'traceId', 'trace_id', 'spanId', 'span_id', 'parentSpanId', 'parent_span_id',
    'requestId', 'request_id', 'sessionId', 'session_id', 'userId', 'user_id', 'user',
    'tenantId', 'tenant_id', 'projectId', 'project_id', 'organizationId', 'organization_id',
    'environment', 'applicationName', 'application_name', 'applicationVersion', 'application_version',
    'sdkName', 'sdk_name', 'sdkVersion', 'sdk_version', 'release', 'timestamp', 'route', 'url',
    'service', 'framework', 'serverName', 'server_name',
    'spanCount', 'span_count', 'rootSpanStatus', 'root_span_status', 'isPartial', 'is_partial',
    'clientIp', 'client_ip', 'userAgent', 'user_agent', 'referer',
]);
function requestAttributes(ev) {
    const r = rec(ev);
    const attributes = {};
    if (r.headers && typeof r.headers === 'object' && !Array.isArray(r.headers)) {
        attributes.headers = r.headers;
    }
    if (r.query && typeof r.query === 'object' && !Array.isArray(r.query)) {
        attributes.query = r.query;
    }
    if (r.body && typeof r.body === 'object' && !Array.isArray(r.body)) {
        attributes.body = r.body;
    }
    if (r.attributes && typeof r.attributes === 'object' && !Array.isArray(r.attributes)) {
        Object.assign(attributes, r.attributes);
    }
    if (r.extra && typeof r.extra === 'object' && !Array.isArray(r.extra)) {
        Object.assign(attributes, r.extra);
    }
    if (r.tags && typeof r.tags === 'object' && !Array.isArray(r.tags)) {
        attributes.tags = r.tags;
    }
    for (const key of REQUEST_ATTRIBUTE_DUPLICATES)
        delete attributes[key];
    return attributes;
}
const TRACE_ATTRIBUTE_DUPLICATES = new Set([
    'endpoint', 'http_method', 'httpMethod', 'status_code', 'statusCode',
    'duration_ms', 'durationMs', 'total_duration_ms', 'totalDuration',
    'response_size', 'responseSize', 'trace_id', 'traceId', 'span_id', 'spanId',
    'root_span_id', 'rootSpanId', 'root_span_name', 'rootSpanName',
    'root_span_status', 'rootSpanStatus', 'span_kind', 'spanKind',
    'request_id', 'requestId', 'session_id', 'sessionId',
    'project_id', 'projectId', 'organization_id', 'organizationId',
    'environment', 'sdk_name', 'sdkName', 'sdk_version', 'sdkVersion',
    'application_name', 'applicationName', 'application_version', 'applicationVersion',
    'release', 'timestamp',
]);
function plainObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
function attrValue(attrs, path) {
    if (!attrs)
        return undefined;
    if (Object.prototype.hasOwnProperty.call(attrs, path))
        return attrs[path];
    return path.split('.').reduce((cur, key) => plainObject(cur)?.[key], attrs);
}
const SPAN_ATTRIBUTE_DUPLICATES = [
    'http.method', 'http.route', 'route', 'http.target', 'http.url', 'http.host',
    'http.scheme', 'http.flavor', 'http.status_code', 'http.status_text',
    'http.response.body.size', 'http.user_agent', 'http.client_ip',
    'net.transport', 'net.host.name', 'net.host.ip', 'net.host.port',
    'net.peer.ip', 'net.peer.port',
    'db.system', 'db.name', 'db.operation', 'db.collection', 'db.statement', 'query',
    'messaging.system', 'messaging.destination', 'messaging.operation',
    'pulse.request_id', 'pulse.tenant_id',
];
function deleteAttrPath(attrs, path) {
    delete attrs[path];
    const parts = path.split('.');
    let cur = attrs;
    const parents = [];
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        const next = plainObject(cur?.[key]);
        if (!next)
            return;
        parents.push([cur, key]);
        cur = next;
    }
    delete cur[parts[parts.length - 1]];
    for (let i = parents.length - 1; i >= 0; i--) {
        const [parent, key] = parents[i];
        const child = plainObject(parent[key]);
        if (child && Object.keys(child).length === 0)
            delete parent[key];
    }
}
function resolveDbSystem(attrs, fallback) {
    const val = attrValue(attrs, 'db.system.name') ?? attrValue(attrs, 'db.system') ?? fallback;
    return str(val, 50);
}
function resolveDbName(attrs, fallback) {
    const val = attrValue(attrs, 'db.namespace') ?? attrValue(attrs, 'db.name') ?? fallback;
    return str(val, 100);
}
function resolveDbOperation(attrs, fallback) {
    const val = attrValue(attrs, 'db.operation.name') ?? attrValue(attrs, 'db.operation') ?? fallback;
    return str(val, 50);
}
function resolveDbCollection(attrs, fallback) {
    const val = attrValue(attrs, 'db.collection.name') ?? attrValue(attrs, 'db.collection') ?? fallback;
    return str(val, 100);
}
function resolveDbStatement(attrs, fallback) {
    const val = attrValue(attrs, 'db.query.text') ?? attrValue(attrs, 'db.statement') ?? attrValue(attrs, 'query') ?? fallback;
    return str(val, 8192);
}
function resolvePeerAddress(attrs, fallback) {
    const val = attrValue(attrs, 'server.address') ?? attrValue(attrs, 'net.peer.name') ?? attrValue(attrs, 'net.peer.ip') ?? fallback;
    return str(val, 255);
}
function resolvePeerPort(attrs, fallback) {
    const val = attrValue(attrs, 'server.port') ?? attrValue(attrs, 'net.peer.port') ?? fallback;
    return num(val);
}
function normalizedSpanAttributes(attrs) {
    // Preserve full attributes so users can inspect queries, parameters, and telemetry context without loss
    return attrs ? { ...attrs } : {};
}
function classifySpan(kind, name, attrs) {
    const n = (name ?? '').toLowerCase();
    const dbSystem = resolveDbSystem(attrs);
    const msgSystem = attrValue(attrs, 'messaging.system');
    if (attrValue(attrs, 'http.method') || attrValue(attrs, 'http.route') || attrValue(attrs, 'http.url'))
        return 'http';
    if (dbSystem)
        return n.includes('redis') || n.includes('memcache') ? 'cache' : 'database';
    if (attrValue(attrs, 'db.operation') || attrValue(attrs, 'db.operation.name') || attrValue(attrs, 'db.collection') || attrValue(attrs, 'db.collection.name') || attrValue(attrs, 'db.statement') || attrValue(attrs, 'db.query.text'))
        return 'database';
    if (msgSystem)
        return kind === 'producer' ? 'producer' : kind === 'consumer' ? 'consumer' : 'messaging';
    if (n.includes('redis') || n.includes('cache') || n.includes('memcache'))
        return 'cache';
    if (n.startsWith('mongodb.') || n.startsWith('prisma.') || n.startsWith('pg.') || n.startsWith('mysql.') || n.startsWith('postgres.') || n.startsWith('mongo.'))
        return 'database';
    if (n.startsWith('find ') || n.includes('findone') || n.startsWith('insert') || n.startsWith('update') || n.startsWith('delete') || n.includes('createindexes') || n.startsWith('aggregate'))
        return 'database';
    if (n.includes('queue'))
        return 'queue';
    if (n.includes('rpc') || n.includes('grpc'))
        return 'rpc';
    if (n.includes('cron'))
        return 'cron';
    if (n.includes('schedule'))
        return 'scheduler';
    if (kind === 'producer')
        return 'producer';
    if (kind === 'consumer')
        return 'consumer';
    if (kind === 'internal')
        return 'internal';
    return 'unknown';
}
function traceAttributes(ev) {
    const r = rec(ev);
    const attributes = r.attributes && typeof r.attributes === 'object' && !Array.isArray(r.attributes)
        ? { ...r.attributes }
        : {};
    for (const key of TRACE_ATTRIBUTE_DUPLICATES)
        delete attributes[key];
    return attributes;
}
const METRIC_ATTRIBUTE_DUPLICATES = [
    'metricName', 'metric_name', 'metricType', 'metric_type', 'metricUnit', 'metric_unit', 'unit',
    'metricNamespace', 'metric_namespace', 'metricDescription', 'metric_description',
    'value', 'count', 'sum', 'min', 'max', 'avg', 'rate', 'p50', 'p75', 'p90', 'p95', 'p99',
    'aggregationType', 'aggregation_type', 'temporality', 'isMonotonic', 'is_monotonic',
    'endpoint', 'path', 'route', 'method', 'httpMethod', 'http_method', 'status', 'statusCode', 'status_code',
    'requestId', 'request_id', 'sessionId', 'session_id', 'traceId', 'trace_id', 'spanId', 'span_id',
    'tenantId', 'tenant_id', 'projectId', 'project_id', 'organizationId', 'organization_id',
    'environment', 'applicationName', 'application_name', 'applicationVersion', 'application_version',
    'sdkName', 'sdk_name', 'sdkVersion', 'sdk_version', 'release', 'timestamp',
];
function metricAttributes(ev) {
    const attrs = plainObject(rec(ev).attributes);
    const out = attrs ? { ...attrs } : {};
    for (const key of METRIC_ATTRIBUTE_DUPLICATES)
        deleteAttrPath(out, key);
    return out;
}
function tagValue(tags, ...keys) {
    if (!tags)
        return undefined;
    for (const key of keys) {
        const value = tags[key];
        if (value !== undefined && value !== null && value !== '')
            return value;
    }
    return undefined;
}
function classifyMetric(name, type, tags) {
    const n = name.toLowerCase();
    const ns = String(tagValue(tags, 'namespace', 'metric_namespace') ?? '').toLowerCase();
    if (tagValue(tags, 'path', 'route', 'http.route') || tagValue(tags, 'method', 'http.method') || n.startsWith('http.') || n.includes('http.'))
        return 'http';
    if (n.startsWith('db.') || n.includes('database') || tagValue(tags, 'db.system'))
        return 'database';
    if (n.includes('redis') || n.includes('cache') || n.includes('memcache'))
        return 'cache';
    if (n.includes('queue') || tagValue(tags, 'messaging.system'))
        return 'queue';
    if (n.startsWith('runtime.') || ns === 'runtime')
        return 'runtime';
    if (n.startsWith('system.') || ns === 'system')
        return 'system';
    if (n.includes('network') || n.includes('net.'))
        return 'network';
    if (n.includes('memory') || n.includes('heap') || n.includes('rss'))
        return 'memory';
    if (n.includes('cpu'))
        return 'cpu';
    if (n.includes('disk') || n.includes('fs.'))
        return 'disk';
    if (n.startsWith('business.') || ns === 'business')
        return 'business';
    if (n.startsWith('app.') || n.startsWith('application.') || type === 'gauge')
        return 'application';
    return 'custom';
}
function aggregationType(metricType) {
    return ['counter', 'gauge', 'histogram', 'summary', 'observable_counter', 'observable_gauge', 'up_down_counter'].includes(metricType)
        ? metricType
        : 'gauge';
}
/** Preserve the exact normalized SDK event so newly added SDK fields are never lost. */
function payloadFor(ev) {
    return JSON.stringify(ev);
}
/** Safe optional string with a max length, else null. */
function str(v, max = 255) {
    return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}
/** Safe optional finite number, else null. */
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function httpStatus(v) {
    const value = num(v);
    return value != null && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}
function bool(v) {
    return typeof v === 'boolean' ? v : null;
}
/** Basic IPv4/IPv6 validation so an invalid string can't fail an INET insert. */
const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/;
function inet(v) {
    return typeof v === 'string' && IP_RE.test(v) ? v.slice(0, 45) : null;
}
// ── Enum coercion to the migrations2/004 enum domains ───────────────────────
function eventSeverity(v, fallback = 'error') {
    const s = typeof v === 'string' ? v.toLowerCase() : '';
    if (s === 'debug')
        return 'debug';
    if (s === 'info' || s === 'information')
        return 'info';
    if (s === 'warn' || s === 'warning')
        return 'warning';
    if (s === 'error' || s === 'err')
        return 'error';
    if (s === 'fatal' || s === 'critical')
        return 'fatal';
    return fallback;
}
function logLevel(v) {
    const s = typeof v === 'string' ? v.toLowerCase() : '';
    if (s === 'debug')
        return 'debug';
    if (s === 'info')
        return 'info';
    if (s === 'warn' || s === 'warning')
        return 'warn';
    if (s === 'error' || s === 'err' || s === 'fatal' || s === 'critical')
        return 'error';
    return 'info';
}
function spanKind(v) {
    const s = typeof v === 'string' ? v.toLowerCase() : '';
    return ['internal', 'server', 'client', 'producer', 'consumer'].includes(s) ? s : null;
}
function spanStatus(v) {
    const s = typeof v === 'string' ? v.toLowerCase() : '';
    if (s === 'ok')
        return 'ok';
    if (s === 'error' || s === 'err')
        return 'error';
    return 'unset';
}
function classifyMessageCategory(msg, tags, logger, context) {
    const m = (msg ?? '').toLowerCase();
    const t = tags ?? {};
    const c = context ?? {};
    if (t['category'] && typeof t['category'] === 'string')
        return t['category'];
    if (m.includes('security') || m.includes('unauthorized') || m.includes('forbidden') || t['security'] || c['security'])
        return 'security';
    if (m.includes('audit') || t['audit'] || c['audit'])
        return 'audit';
    if (m.includes('http') || m.includes('request') || m.includes('response') || t['http.method'])
        return 'http';
    if (m.includes('auth') || m.includes('login') || m.includes('logout'))
        return 'authentication';
    if (m.includes('permission') || m.includes('access'))
        return 'authorization';
    if (m.includes('database') || m.includes('sql') || m.includes('query') || t['db.system'])
        return 'database';
    if (m.includes('cache') || m.includes('redis') || m.includes('memcached'))
        return 'cache';
    if (m.includes('queue') || m.includes('rabbitmq') || m.includes('kafka') || t['messaging.system'])
        return 'queue';
    if (m.includes('cron') || m.includes('job') || m.includes('schedule') || logger === 'cron')
        return 'cron';
    if (m.includes('system') || m.includes('memory') || m.includes('cpu') || logger === 'system')
        return 'system';
    if (m.includes('business') || m.includes('order') || m.includes('payment') || m.includes('invoice'))
        return 'business';
    return 'application';
}
function classifyMessageSource(sdkName, logger) {
    const s = (sdkName ?? '').toLowerCase();
    const l = (logger ?? '').toLowerCase();
    if (l === 'manual' || s.includes('manual'))
        return 'manual';
    if (l.includes('worker') || s.includes('worker'))
        return 'worker';
    if (l.includes('cron') || l.includes('job'))
        return 'cron';
    if (l.includes('queue') || l.includes('messaging'))
        return 'queue';
    if (s.includes('framework') || l.includes('framework'))
        return 'framework';
    if (s.includes('middleware') || l.includes('middleware'))
        return 'middleware';
    if (s)
        return 'sdk';
    return 'unknown';
}
/** Storage error_name for an error event (shared with the error grouper). */
export function errorNameOf(event) {
    const name = event.name;
    return typeof name === 'string' && name.length > 0 ? name.slice(0, 256) : 'UnknownError';
}
/**
 * Per-event memoization of the storage fingerprint.
 *
 * `errorFingerprint` is called at least TWICE for every error event on the hot
 * path — once in EventProcessor while building the error batch (feeding both
 * `groupParams.fingerprint` and `eventRecord.fingerprint`) and again inside
 * `appendTelemetryOutbox` when composing the outbox attributes — and a third
 * time in `writeErrors` on the non-grouped path. Each call normalizes the stack
 * frame array and runs a sha256, which is pure CPU burned on the event loop of
 * the process that is also supposed to be draining queues.
 *
 * A WeakMap keyed on the event object gives exact-once computation per event
 * with no lifetime management: entries become collectable the moment the batch
 * is released. Keyed on the object identity rather than a derived string so
 * there is zero risk of a hash collision changing a fingerprint.
 *
 * Correctness note: this is only sound because normalized events are treated as
 * immutable after `normalizeEvent()`. The one mutation that does occur —
 * assigning `eventId` in EventProcessor — is not an input to the fingerprint
 * (which reads only `name` and `stack`), so it cannot invalidate a cached value.
 */
const fingerprintCache = new WeakMap();
/**
 * Storage fingerprint for an error event (shared with the error grouper so
 * events_errors.fingerprint and analytics_error_groups.fingerprint agree).
 */
export function errorFingerprint(event, errorName = errorNameOf(event)) {
    const e = event;
    if (typeof event !== 'object' || event === null) {
        return computeErrorFingerprint(errorName, e.stack);
    }
    const cached = fingerprintCache.get(event);
    if (cached !== undefined)
        return cached;
    const fingerprint = computeErrorFingerprint(errorName, e.stack);
    fingerprintCache.set(event, fingerprint);
    return fingerprint;
}
/** Build a parameterized multi-row INSERT. JSONB values are passed as JSON text
 * (unknown→jsonb coercion handles the cast in an INSERT ... VALUES context).
 * ON CONFLICT DO NOTHING (no column target) makes the insert idempotent
 * against the (project_id, event_id) identity indexes. PostgreSQL rowCount is
 * still the inserted-row count, so hot-path inserts avoid RETURNING unless a
 * caller needs returned identity data. */
/**
 * PostgreSQL's wire protocol encodes the bind-parameter count as a signed
 * 16-bit integer, so a single statement can carry at most 65535 parameters.
 * Exceeding it is not a slow query — the statement is rejected outright.
 */
const PG_MAX_BIND_PARAMS = 65535;
/**
 * Target maximum parameters per INSERT statement. Kept bounded (~3500) to avoid
 * CPU-intensive AST planning and index leaf page latch (LWLock) serialization
 * across concurrent workers on the active partition tables.
 */
const PG_TARGET_BIND_PARAMS = 3500;
/**
 * Insert `rows` using bounded multi-row statements, returning the total inserted count.
 *
 * ## Why this is needed
 *
 * Most event types are 1 event -> 1 row, but tables with 40-65 columns (like events_requests
 * and events_spans) with batches of 200 events produce 8,000 to 13,000 parameters per statement.
 *
 * Executing multiple 13,000-parameter statements concurrently across 16 workers saturates
 * PostgreSQL buffer headers and index leaf blocks, causing severe LWLock serialization.
 *
 * Chunking into bounded statements (~3,500 parameters max) bounds memory allocation and
 * allows page latching to be interleaved fairly across parallel workers.
 *
 * Chunking stays inside the caller's transaction, so atomicity is unchanged: either every
 * chunk commits or the transaction rolls back.
 */
async function salvageRows(db, table, cols, rows) {
    let salvaged = 0;
    for (const row of rows) {
        try {
            await db.query('SAVEPOINT row_salvage');
            const { text, values } = buildInsert(table, cols, [row]);
            const res = await db.query(text, values);
            salvaged += res.rowCount ?? 0;
            await db.query('RELEASE SAVEPOINT row_salvage');
        }
        catch {
            await db.query('ROLLBACK TO SAVEPOINT row_salvage').catch(() => undefined);
        }
    }
    return salvaged;
}
async function insertChunked(db, table, cols, rows) {
    if (rows.length === 0)
        return 0;
    const maxRowsPerStatement = Math.max(1, Math.floor(PG_MAX_BIND_PARAMS / cols.length));
    // Common case: the whole batch fits in one statement.
    if (rows.length <= maxRowsPerStatement) {
        try {
            const { text, values } = buildInsert(table, cols, rows);
            const res = await db.query(text, values);
            return res.rowCount ?? 0;
        }
        catch (err) {
            if (rows.length <= 1)
                throw err;
            return salvageRows(db, table, cols, rows);
        }
    }
    let inserted = 0;
    for (let offset = 0; offset < rows.length; offset += maxRowsPerStatement) {
        const chunk = rows.slice(offset, offset + maxRowsPerStatement);
        try {
            const { text, values } = buildInsert(table, cols, chunk);
            const res = await db.query(text, values);
            inserted += res.rowCount ?? 0;
        }
        catch (err) {
            if (chunk.length <= 1)
                throw err;
            inserted += await salvageRows(db, table, cols, chunk);
        }
    }
    return inserted;
}
function buildInsert(table, cols, rows, returning) {
    const values = [];
    const tuples = [];
    let p = 1;
    for (const row of rows) {
        tuples.push(`(${row.map(() => `$${p++}`).join(', ')})`);
        values.push(...row);
    }
    const returningClause = returning ? ` RETURNING ${returning}` : '';
    return {
        text: `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING${returningClause}`,
        values,
    };
}
export async function applyIngestionTransactionSettings(client) {
    const statements = [
        `SET LOCAL synchronous_commit = ${env.INGESTION_LOG_DB_SYNCHRONOUS_COMMIT ?? 'off'}`,
    ];
    if (env.INGESTION_LOG_DB_LOCK_TIMEOUT_MS > 0) {
        statements.push(`SET LOCAL lock_timeout = '${env.INGESTION_LOG_DB_LOCK_TIMEOUT_MS}ms'`);
    }
    if (env.INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS > 0) {
        statements.push(`SET LOCAL statement_timeout = '${env.INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS}ms'`);
    }
    if (env.INGESTION_LOG_DB_IDLE_TX_TIMEOUT_MS > 0) {
        statements.push(`SET LOCAL idle_in_transaction_session_timeout = '${env.INGESTION_LOG_DB_IDLE_TX_TIMEOUT_MS}ms'`);
    }
    await client.query(statements.join('; '));
}
export class TelemetryWriter {
    pool;
    log;
    enricher = RequestEnricher.get();
    constructor(pool, log) {
        this.pool = pool;
        this.log = log;
    }
    /**
     * Route a batch of scoped events to the correct events_* table(s). Mixed
     * types are grouped so each table gets one multi-row insert. Events without a
     * resolvable organization_id are skipped (events_* requires it) and counted
     * out of the return total.
     *
     * Returns the number of rows ACTUALLY inserted (delivery duplicates dropped
     * by ON CONFLICT DO NOTHING are excluded). Kept for legacy callers — new
     * code should use writeBatchDetailed().
     */
    async writeBatch(scoped) {
        return (await this.writeBatchDetailed(scoped)).totalInserted;
    }
    /**
     * writeBatch with the full outcome: per-type received/inserted counts and
     * the error events confirmed inserted (for analytics_error_groups). The
     * inserted counts drive usage accounting, so duplicates delivered by
     * at-least-once retries are never billed twice.
     */
    async writeBatchDetailed(scoped) {
        return this.writeBatchDetailedUsing(this.pool, scoped);
    }
    async writeBatchDetailedWithOutbox(clientOrScoped, scopedParam) {
        if (Array.isArray(clientOrScoped)) {
            const scoped = clientOrScoped;
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');
                await applyIngestionTransactionSettings(client);
                const result = await this.writeBatchDetailedInTransaction(client, scoped);
                if (result.totalInserted > 0) {
                    result.outboxInserted = await this.appendTelemetryOutbox(scoped, client);
                }
                await client.query('COMMIT');
                return result;
            }
            catch (err) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw err;
            }
            finally {
                client.release();
            }
        }
        else {
            const client = clientOrScoped;
            const scoped = scopedParam ?? [];
            const result = await this.writeBatchDetailedInTransaction(client, scoped);
            if (result.totalInserted > 0) {
                result.outboxInserted = await this.appendTelemetryOutbox(scoped, client);
            }
            return result;
        }
    }
    async writeBatchDetailedInTransaction(db, scoped) {
        return this.writeBatchDetailedUsing(db, scoped);
    }
    async writeBatchDetailedUsing(db, scoped) {
        const result = {
            totalReceived: 0,
            totalInserted: 0,
            perType: {},
            insertedErrors: [],
        };
        if (scoped.length === 0)
            return result;
        const byType = new Map();
        for (const s of scoped) {
            if (!s.orgId)
                continue; // organization_id is NOT NULL in events_*
            const list = byType.get(s.event.type) ?? [];
            list.push(s);
            byType.set(s.event.type, list);
        }
        for (const [type, list] of byType) {
            const startedAt = Date.now();
            const res = await this.writeTyped(type, list, db);
            result.perType[type] = {
                received: list.length,
                inserted: res.inserted,
                durationMs: Date.now() - startedAt,
            };
            result.totalReceived += list.length;
            result.totalInserted += res.inserted;
            if (res.insertedErrors)
                result.insertedErrors.push(...res.insertedErrors);
        }
        return result;
    }
    async recordSessions(scoped, db) {
        const sessionMap = new Map();
        for (const s of scoped) {
            if (!s.orgId || !s.projectId)
                continue;
            const recObj = rec(s.event);
            const rawObj = s.event;
            const sessionId = str(s.event.sessionId ?? recObj.sessionId ?? recObj.session_id ?? rawObj.sessionId ?? rawObj.session_id, 64);
            if (!sessionId)
                continue;
            const key = `${s.orgId}:${s.projectId}:${sessionId}`;
            const ts = iso(resolveScopedTimestamp(s.event, s.occurredAtMs));
            const isErr = s.event.type === 'error' || (recObj.statusCode != null && Number(recObj.statusCode) >= 500);
            const isCrashed = isErr && (bool(recObj.handled) === false || recObj.crashed === true);
            const userId = str(recObj.userId ?? recObj.user_id ?? recObj.user?.id, 255);
            const existing = sessionMap.get(key);
            if (existing) {
                existing.eventCount += 1;
                if (isErr)
                    existing.errorCount += 1;
                if (isCrashed)
                    existing.isCrashed = true;
                if (userId && !existing.userId)
                    existing.userId = userId;
                if (ts < existing.startedAt)
                    existing.startedAt = ts;
                if (ts > existing.endedAt)
                    existing.endedAt = ts;
            }
            else {
                sessionMap.set(key, {
                    orgId: s.orgId,
                    projectId: s.projectId,
                    sessionId,
                    userId,
                    environment: s.environment,
                    startedAt: ts,
                    endedAt: ts,
                    eventCount: 1,
                    errorCount: isErr ? 1 : 0,
                    isCrashed,
                });
            }
        }
        if (sessionMap.size === 0)
            return;
        try {
            const rows = Array.from(sessionMap.values());
            const BATCH_SIZE = 500;
            for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const batch = rows.slice(i, i + BATCH_SIZE);
                await db.query(`INSERT INTO analytics_user_sessions (
            organization_id, project_id, session_id, user_id, environment,
            started_at, ended_at, duration_seconds, event_count, error_count, is_crashed
          )
          SELECT t.org_id, t.proj_id, t.sess_id, t.user_id, t.env,
                 t.started_at, t.ended_at,
                 GREATEST(0, EXTRACT(EPOCH FROM (t.ended_at - t.started_at))::integer),
                 t.event_count, t.error_count, t.is_crashed
          FROM UNNEST(
            $1::uuid[],
            $2::uuid[],
            $3::text[],
            $4::text[],
            $5::text[],
            $6::timestamptz[],
            $7::timestamptz[],
            $8::integer[],
            $9::integer[],
            $10::boolean[]
          ) AS t(org_id, proj_id, sess_id, user_id, env, started_at, ended_at, event_count, error_count, is_crashed)
          ON CONFLICT (organization_id, project_id, session_id)
          DO UPDATE SET
            ended_at = GREATEST(analytics_user_sessions.ended_at, EXCLUDED.ended_at),
            duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(analytics_user_sessions.ended_at, EXCLUDED.ended_at) - analytics_user_sessions.started_at))::integer),
            event_count = analytics_user_sessions.event_count + EXCLUDED.event_count,
            error_count = analytics_user_sessions.error_count + EXCLUDED.error_count,
            is_crashed = analytics_user_sessions.is_crashed OR EXCLUDED.is_crashed,
            user_id = COALESCE(analytics_user_sessions.user_id, EXCLUDED.user_id),
            environment = COALESCE(analytics_user_sessions.environment, EXCLUDED.environment)`, [
                    batch.map((r) => r.orgId),
                    batch.map((r) => r.projectId),
                    batch.map((r) => r.sessionId),
                    batch.map((r) => r.userId),
                    batch.map((r) => r.environment),
                    batch.map((r) => r.startedAt),
                    batch.map((r) => r.endedAt),
                    batch.map((r) => r.eventCount),
                    batch.map((r) => r.errorCount),
                    batch.map((r) => r.isCrashed),
                ]);
            }
        }
        catch (err) {
            this.log?.debug({ err }, 'Failed to record session tracking rows');
        }
    }
    async appendTelemetryOutbox(scoped, db = this.pool) {
        const rows = scoped
            .filter((event) => event.orgId !== null)
            .filter((event) => isFastPathSignal(event))
            .map((event) => {
            const record = rec(event.event);
            const latencyVal = record.latency ?? record.latencyMs ?? record.latency_ms ?? record.durationMs ?? record.duration_ms ?? record.duration;
            const errName = errorNameOf(event.event);
            const fingerprint = errorFingerprint(event.event, errName);
            const rawEvent = event.event;
            return [
                event.orgId,
                event.projectId,
                event.environment,
                event.event.type,
                this.eventId(event.event),
                outboxSeverity(event.event),
                isFastPathSignal(event),
                JSON.stringify({
                    eventType: event.event.type,
                    message: str(record.message, 4096),
                    service: str(record.service, 100),
                    requestId: str(record.requestId ?? record.request_id ?? rawEvent.requestId ?? rawEvent.request_id, 64),
                    traceId: str(record.traceId ?? record.trace_id ?? rawEvent.traceId ?? rawEvent.trace_id, 128),
                    spanId: str(record.spanId ?? record.span_id ?? rawEvent.spanId ?? rawEvent.span_id, 64),
                    monitorSlug: str(record.monitorSlug, 255),
                    statusCode: record.statusCode ?? record.status_code,
                    latency: latencyVal,
                    latencyMs: latencyVal,
                    durationMs: latencyVal,
                    method: record.method,
                    route: record.route ?? record.endpoint ?? record.url,
                    url: record.url,
                    responseSize: record.responseSize ?? record.response_size,
                    release: str(record.release ?? rawEvent.release, 100),
                    applicationName: str(record.applicationName ?? record.application_name, 100),
                    environment: event.environment,
                    projectSlug: event.projectSlug,
                    projectName: event.projectName,
                    orgSlug: event.orgSlug,
                    orgName: event.orgName,
                    ...(event.event.type === 'error' ? {
                        errorName: errName,
                        name: errName,
                        fingerprint,
                        stack: record.stack ?? rawEvent.stack,
                        stackFrames: record.stackFrames ?? record.stack_frames ?? record.frames ?? rawEvent.stack_frames,
                        handled: record.handled ?? rawEvent.handled,
                        mechanism: record.mechanism ?? rawEvent.mechanism,
                        severity: outboxSeverity(event.event) ?? 'error',
                    } : {}),
                }),
                iso(resolveScopedTimestamp(event.event, event.occurredAtMs)),
            ];
        });
        if (rows.length === 0)
            return 0;
        const result = await db.query(`WITH input AS (
         SELECT organization_id, project_id, environment, signal_kind, event_id,
                severity, fast_path, attributes, occurred_at
           FROM UNNEST(
             $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[],
             $6::logdb_severity[], $7::boolean[], $8::jsonb[], $9::timestamptz[]
           ) AS t(organization_id, project_id, environment, signal_kind, event_id,
                  severity, fast_path, attributes, occurred_at)
       ), reserved AS (
         INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
         SELECT 'telemetry_outbox', organization_id, signal_kind || ':' || event_id
           FROM input
         ON CONFLICT DO NOTHING
         RETURNING organization_id, idempotency_key
       ), inserted AS (
         INSERT INTO telemetry_outbox (
           organization_id, project_id, environment, signal_kind, event_id,
           severity, fast_path, attributes, occurred_at
         )
         SELECT t.organization_id, t.project_id, t.environment, t.signal_kind, t.event_id,
                t.severity, t.fast_path, t.attributes, t.occurred_at
           FROM input t
           JOIN reserved r
             ON r.organization_id = t.organization_id
            AND r.idempotency_key = t.signal_kind || ':' || t.event_id
         ON CONFLICT DO NOTHING
         RETURNING id
       )
       SELECT COUNT(*)::int AS count FROM inserted`, [
            rows.map((row) => row[0]),
            rows.map((row) => row[1]),
            rows.map((row) => row[2]),
            rows.map((row) => row[3]),
            rows.map((row) => row[4]),
            rows.map((row) => row[5]),
            rows.map((row) => row[6]),
            rows.map((row) => row[7]),
            rows.map((row) => row[8]),
        ]);
        return Number(result.rows[0]?.count ?? 0);
    }
    async writeTyped(type, list, db) {
        switch (type) {
            case 'error': return this.writeErrors(list, db);
            case 'message': return this.writeMessages(list, db);
            case 'request': return this.writeRequests(list, db);
            case 'span': return this.writeSpans(list, db);
            case 'trace': return this.writeTraces(list, db);
            case 'metric': return this.writeMetrics(list, db);
            case 'log': return this.writeLogs(list, db);
            case 'profile': return this.writeProfiles(list, db);
            case 'cron_checkin': return this.writeCronCheckins(list, db);
            case 'replay': return this.writeReplays(list, db);
            default: return { inserted: 0 };
        }
    }
    /** Best-effort event id (events_*.event_id is NOT NULL). */
    eventId(ev) {
        const id = ev.eventId;
        return typeof id === 'string' && id.length > 0 ? id.slice(0, 64) : uuidv7();
    }
    // ── events_errors ─────────────────────────────────────────────────────────
    async writeErrors(list, db) {
        const ids = list.map(({ event }) => this.eventId(event));
        const rows = list.map(({ projectId, orgId, environment, apiKeyName, occurredAtMs, event }, i) => {
            const e = event;
            const r = rec(event);
            const errorName = errorNameOf(event);
            const metadata = metadataFor(event, environment);
            const fingerprint = errorFingerprint(event, errorName);
            const req = e.context?.request || e.context || {};
            const statusCode = httpStatus(e.statusCode ?? r.statusCode ?? req.statusCode ?? req.status_code);
            const statusText = str(e.statusText ?? r.statusText ?? req.statusText ?? req.status_text
                ?? (statusCode == null ? null : STATUS_CODES[statusCode]), 128);
            const handled = bool(e.handled ?? r.handled);
            return [
                orgId, projectId, apiKeyName ?? '', ids[i], fingerprint, ERROR_FINGERPRINT_VERSION, e.message,
                errorName, eventSeverity(e.severity, 'error'),
                e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null,
                str(e.mechanism ?? r.mechanism, 50), str(r.service, 100),
                environment, str(metadataField(metadata, event, 'release'), 100), str(metadataField(metadata, event, 'serverName'), 100),
                str(metadataField(metadata, event, 'applicationName'), 100), str(metadataField(metadata, event, 'applicationVersion'), 50),
                JSON.stringify(e.stack ?? []), JSON.stringify(e.breadcrumbs ?? []), JSON.stringify(e.context ?? {}),
                str(e.method ?? r.method ?? req.method, 32), str(e.route ?? r.route ?? req.route ?? req.endpoint, 8192), str(e.url ?? r.url ?? req.url, 8192),
                statusCode ?? null, statusText ?? null, handled,
                str(r.userId ?? r.user?.id ?? e.context?.userId, 255),
                str(metadataField(metadata, event, 'sdkName'), 50), str(metadataField(metadata, event, 'sdkVersion'), 50),
                JSON.stringify(r.tags ?? {}), JSON.stringify(r.extra ?? {}), JSON.stringify(metadata), iso(resolveScopedTimestamp(event, occurredAtMs)),
                payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
                list[i]?.errorGroupId ?? e?.errorGroupId ?? e?.error_group_id ?? null,
                uuidv7(), generatePublicId(PUBLIC_ID_PREFIXES.errors), new Date().toISOString(), new Date().toISOString(),
            ];
        });
        const errorCols = [
            'organization_id', 'project_id', 'api_key_name', 'event_id', 'fingerprint', 'fingerprint_version', 'message',
            'error_name', 'severity', 'trace_id', 'span_id', 'request_id', 'session_id',
            'mechanism', 'service', 'environment', 'release', 'server_name',
            'application_name', 'application_version',
            'stack_frames', 'breadcrumbs', 'context', 'method', 'route', 'url',
            'status_code', 'status_text', 'handled', 'user_id',
            'sdk_name', 'sdk_version', 'tags', 'extra', 'metadata', 'occurred_at', 'payload', 'ai_response',
            'error_group_id',
            'id', 'public_id', 'created_at', 'ingested_at'
        ];
        let res;
        try {
            const { text, values } = buildInsert('events_errors', errorCols, rows, 'event_id');
            res = await db.query(text, values);
        }
        catch (err) {
            if (rows.length <= 1)
                throw err;
            const salvagedRows = [];
            for (const row of rows) {
                try {
                    await db.query('SAVEPOINT err_salvage');
                    const { text, values } = buildInsert('events_errors', errorCols, [row], 'event_id');
                    const singleRes = await db.query(text, values);
                    if (singleRes.rows && singleRes.rows.length > 0) {
                        salvagedRows.push(...singleRes.rows);
                    }
                    await db.query('RELEASE SAVEPOINT err_salvage');
                }
                catch {
                    await db.query('ROLLBACK TO SAVEPOINT err_salvage').catch(() => undefined);
                }
            }
            res = { rows: salvagedRows, rowCount: salvagedRows.length };
        }
        // Pair each returned event_id with its first unpaired input occurrence, so
        // a duplicate event_id WITHIN one batch (only the first occurrence inserts)
        // is not double-counted by downstream error grouping.
        const unpaired = new Map();
        for (const row of (res?.rows ?? []))
            unpaired.set(row.event_id, (unpaired.get(row.event_id) ?? 0) + 1);
        const insertedErrors = [];
        for (let i = 0; i < list.length; i++) {
            const id = ids[i];
            const n = unpaired.get(id) ?? 0;
            if (n > 0) {
                insertedErrors.push(list[i]);
                if (n === 1)
                    unpaired.delete(id);
                else
                    unpaired.set(id, n - 1);
            }
        }
        return { inserted: res?.rowCount ?? 0, insertedErrors };
    }
    // ── events_messages ─────────────────────────────────────────────────────────
    async writeMessages(list, db) {
        const rows = list.map(({ projectId, orgId, environment, apiKeyName, occurredAtMs, event }) => {
            const e = event;
            const r = rec(event);
            const metadata = metadataFor(event, environment);
            const tags = plainObject(r.tags) ?? {};
            const ctx = plainObject(e.context) ?? {};
            const attrs = plainObject(r.attributes) ?? {};
            const loggerName = str(e.loggerName ?? r.loggerName ?? r.logger, 128);
            const sdkName = str(metadataField(metadata, event, 'sdkName'), 50);
            const name = str(e.name ?? r.name, 256) ?? str(e.message, 100) ?? 'Untitled';
            const tenantId = str(e.tenantId ?? r.tenantId ?? attrValue(attrs, 'tenantId') ?? r.extra?.tenantId, 255);
            const messageCategory = classifyMessageCategory(e.message, tags, loggerName, ctx);
            const messageSource = classifyMessageSource(sdkName, loggerName);
            return [
                orgId, projectId, apiKeyName ?? '', this.eventId(event), e.message, eventSeverity(e.severity, 'info'),
                e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null,
                str(r.service, 100), environment, str(metadataField(metadata, event, 'release'), 100),
                str(metadataField(metadata, event, 'serverName'), 100), str(metadataField(metadata, event, 'applicationName'), 100), str(metadataField(metadata, event, 'applicationVersion'), 50),
                str(r.userId, 255), inet(r.userIp),
                JSON.stringify(tags), JSON.stringify(ctx), JSON.stringify(e.breadcrumbs ?? []),
                sdkName, str(metadataField(metadata, event, 'sdkVersion'), 50), JSON.stringify(metadata), iso(resolveScopedTimestamp(event, occurredAtMs)),
                payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
                tenantId, loggerName, messageCategory, messageSource,
                str(e.endpoint ?? r.endpoint, 8192), num(e.statusCode ?? r.statusCode ?? r.status_code),
                name, JSON.stringify(attrs),
                uuidv7(), generatePublicId(PUBLIC_ID_PREFIXES.messages), new Date().toISOString(), new Date().toISOString(),
            ];
        });
        const cols = [
            'organization_id', 'project_id', 'api_key_name', 'event_id', 'message', 'severity',
            'trace_id', 'span_id', 'request_id', 'session_id',
            'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
            'user_id', 'user_ip',
            'tags', 'contexts', 'breadcrumbs', 'sdk_name', 'sdk_version', 'metadata', 'occurred_at', 'payload', 'ai_response',
            'tenant_id', 'logger_name', 'message_category', 'message_source',
            'endpoint', 'status_code', 'name', 'attributes',
            'id', 'public_id', 'created_at', 'ingested_at'
        ];
        const inserted = await insertChunked(db, 'events_messages', cols, rows);
        return { inserted };
    }
    // ── events_requests ─────────────────────────────────────────────────────────
    async writeRequests(list, db) {
        // Warm optional GeoIP readers without putting request inserts behind file
        // open/dynamic import latency. Until ready, enrichment still hashes IPs and
        // parses user agents, while geo columns remain NULL.
        void this.enricher.init();
        const rows = list.map(({ projectId, orgId, environment, apiKeyName, occurredAtMs, event }) => {
            const e = event;
            const r = rec(event);
            const metadata = metadataFor(event, environment);
            const endpoint = str(r.route, 500) ?? str(e.url, 8192) ?? str(r.endpoint, 8192);
            const name = endpoint ? `${e.method} ${endpoint}`.slice(0, 1024) : e.method;
            const headers = (e.headers && typeof e.headers === 'object') ? e.headers : {};
            const rawUserAgent = r.userAgent ?? r.user_agent ?? headers['user-agent'] ?? headers['User-Agent'] ?? null;
            const rawClientIp = r.clientIp ?? r.client_ip ?? headers['x-forwarded-for'] ?? headers['x-real-ip'] ?? null;
            // Enrich clientIp -> geo, userAgent -> browser/os/device.
            const g = this.enricher.enrich(rawClientIp, rawUserAgent);
            const userId = str(r.user?.id ?? r.userId ?? r.user_id, 255);
            const tenantId = str(r.tenantId ?? r.extra?.tenantId ?? r.tenant_id, 255);
            const framework = str(r.framework ?? r.tags?.framework, 50);
            const service = str(r.service ?? metadataField(metadata, event, 'applicationName'), 100) ?? 'unknown';
            const statusCode = httpStatus(e.statusCode ?? r.statusCode ?? r.status_code);
            const durationMs = num(e.latency ?? r.duration_ms ?? r.durationMs);
            return [
                uuidv7(), // 1. id
                orgId, // 2. organization_id
                projectId, // 3. project_id
                apiKeyName ?? 'unknown', // 4. api_key_name
                this.eventId(event), // 5. event_id
                str(e.requestId ?? r.requestId ?? r.request_id, 64) ?? this.eventId(event), // 6. request_id
                e.traceId ?? str(r.traceId ?? r.trace_id, 64), // 7. trace_id
                e.spanId ?? str(r.spanId ?? r.span_id, 64), // 8. span_id
                str(r.parentSpanId ?? r.parent_span_id, 64), // 9. parent_span_id
                e.sessionId ?? str(r.sessionId ?? r.session_id, 64), // 10. session_id
                userId, // 11. user_id
                tenantId, // 12. tenant_id
                endpoint, // 13. endpoint
                name, // 14. name
                e.method, // 15. method
                statusCode, // 16. status_code
                durationMs, // 17. duration_ms
                num(e.bodySize ?? r.body_size), // 18. body_size
                num(r.responseSize ?? r.response_size), // 19. response_size
                num(r.spanCount ?? r.span_count), // 20. span_count
                str(r.rootSpanStatus ?? r.root_span_status, 32), // 21. root_span_status
                bool(r.isPartial ?? r.is_partial), // 22. is_partial
                g.clientIpHash, // 23. client_ip_hash
                str(rawUserAgent, 1024), // 24. user_agent
                str(r.referer ?? headers['referer'] ?? headers['Referer'], 1024), // 25. referer
                g.geoCountryCode, // 26. geo_country_code
                g.geoRegion, // 27. geo_region
                g.geoAsn, // 28. geo_asn
                g.browserFamily, // 29. browser_family
                g.browserVersionMajor != null ? String(g.browserVersionMajor) : null, // 30. browser_version_major
                g.osName, // 31. os_name
                g.osVersionMajor != null ? String(g.osVersionMajor) : null, // 32. os_version_major
                g.deviceType, // 33. device_type
                g.isBot, // 34. is_bot
                service, // 35. service
                framework, // 36. framework
                environment, // 37. environment
                str(r.release ?? metadataField(metadata, event, 'release'), 100), // 38. release
                str(r.serverName ?? metadataField(metadata, event, 'serverName'), 100), // 39. server_name
                str(metadataField(metadata, event, 'sdkName'), 50), // 40. sdk_name
                str(metadataField(metadata, event, 'sdkVersion'), 50), // 41. sdk_version
                eventSeverity(r.severity, (statusCode ?? 200) >= 500 ? 'error' : 'info'), // 42. severity
                JSON.stringify(requestAttributes(event)), // 43. attributes
                JSON.stringify(metadata), // 44. metadata
                payloadFor(event), // 45. payload
                e.aiResponse != null ? JSON.stringify(e.aiResponse) : (r.ai_response != null ? JSON.stringify(r.ai_response) : null), // 46. ai_response
                iso(resolveScopedTimestamp(event, occurredAtMs)), // 47. occurred_at
                generatePublicId(PUBLIC_ID_PREFIXES.requests), // 48. public_id
                new Date().toISOString(), // 49. created_at
                new Date().toISOString(), // 50. ingested_at
            ];
        });
        // is_slow / is_error are GENERATED columns — do NOT insert them.
        const cols = [
            'id', 'organization_id', 'project_id', 'api_key_name', 'event_id', 'request_id', 'trace_id', 'span_id',
            'parent_span_id', 'session_id', 'user_id', 'tenant_id', 'endpoint', 'name', 'method',
            'status_code', 'duration_ms', 'body_size', 'response_size', 'span_count', 'root_span_status', 'is_partial',
            'client_ip_hash', 'user_agent', 'referer', 'geo_country_code', 'geo_region', 'geo_asn',
            'browser_family', 'browser_version_major', 'os_name', 'os_version_major', 'device_type', 'is_bot',
            'service', 'framework', 'environment', 'release', 'server_name', 'sdk_name', 'sdk_version',
            'severity', 'attributes', 'metadata', 'payload', 'ai_response', 'occurred_at',
            'public_id', 'created_at', 'ingested_at'
        ];
        const inserted = await insertChunked(db, 'events_requests', cols, rows);
        return { inserted };
    }
    // ── events_spans ─────────────────────────────────────────────────────────
    async writeSpans(list, db) {
        const rows = list.map(({ projectId, orgId, environment, apiKeyName, occurredAtMs, event }) => {
            const e = event;
            const r = rec(event);
            const attrs = plainObject(e.attributes) ?? {};
            const metadata = metadataFor(event, environment);
            const kind = spanKind(e.kind);
            const status = spanStatus(e.status);
            const endpoint = str(attrValue(attrs, 'http.route') ?? attrValue(attrs, 'route'), 500);
            const spanType = classifySpan(kind, str(e.name, 500), attrs);
            const isHttp = spanType === 'http';
            const isDb = spanType === 'database';
            const isCache = spanType === 'cache';
            const isMessaging = ['messaging', 'queue', 'producer', 'consumer'].includes(spanType);
            const requestId = e.requestId ?? str(attrValue(attrs, 'pulse.request_id'), 255);
            const tenantId = str(r.tenantId, 255) ?? str(attrValue(attrs, 'pulse.tenant_id'), 255);
            return [
                orgId, projectId, apiKeyName ?? '', this.eventId(event), e.spanId, e.traceId, e.parentSpanId ?? null,
                kind, spanType, status, e.parentSpanId == null, isHttp, isDb, isCache, isMessaging,
                e.name, e.statusMessage ?? null, endpoint,
                parseSafeIsoTimestamp(e.startTime, { traceId: e.traceId, spanId: e.spanId, field: 'startTime', logger: this.log }),
                parseSafeIsoTimestamp(e.endTime, { traceId: e.traceId, spanId: e.spanId, field: 'endTime', logger: this.log }),
                num(e.duration), num(e.exclusiveDuration), iso(resolveScopedTimestamp(event, occurredAtMs)),
                str(attrValue(attrs, 'http.method'), 10), str(attrValue(attrs, 'http.route'), 500),
                str(attrValue(attrs, 'http.url'), 8192), str(attrValue(attrs, 'http.target'), 2048),
                str(attrValue(attrs, 'http.host'), 255), str(attrValue(attrs, 'http.scheme'), 32),
                str(attrValue(attrs, 'http.flavor'), 32), num(attrValue(attrs, 'http.status_code')),
                str(attrValue(attrs, 'http.status_text'), 255), num(attrValue(attrs, 'http.response.body.size')),
                str(attrValue(attrs, 'http.user_agent'), 1024), str(attrValue(attrs, 'http.client_ip'), 255),
                str(attrValue(attrs, 'net.transport'), 64), str(attrValue(attrs, 'net.host.name'), 255),
                str(attrValue(attrs, 'net.host.ip'), 255), num(attrValue(attrs, 'net.host.port')),
                resolvePeerAddress(attrs, attrValue(attrs, 'net.peer.ip')), resolvePeerPort(attrs, attrValue(attrs, 'net.peer.port')),
                resolveDbSystem(attrs, r.dbSystem), resolveDbName(attrs, r.dbName),
                resolveDbOperation(attrs, r.dbOperation), resolveDbCollection(attrs, r.dbCollection),
                resolveDbStatement(attrs, r.dbStatement),
                str(attrValue(attrs, 'messaging.system') ?? r.messagingSystem, 50),
                str(attrValue(attrs, 'messaging.destination') ?? r.messagingDestination, 255),
                str(attrValue(attrs, 'messaging.operation') ?? r.messagingOperation, 50),
                JSON.stringify(normalizedSpanAttributes(attrs)), JSON.stringify(e.events ?? []), JSON.stringify(e.links ?? []),
                requestId, e.sessionId ?? null, str(r.userId, 255), tenantId,
                str(r.service, 100), environment, str(metadataField(metadata, event, 'release'), 100),
                str(metadataField(metadata, event, 'serverName'), 100), str(metadataField(metadata, event, 'applicationName'), 100), str(metadataField(metadata, event, 'applicationVersion'), 50),
                str(metadataField(metadata, event, 'sdkName'), 50), str(metadataField(metadata, event, 'sdkVersion'), 50), JSON.stringify(metadata),
                payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
                uuidv7(), generatePublicId(PUBLIC_ID_PREFIXES.spans), new Date().toISOString(), new Date().toISOString(),
            ];
        });
        const cols = [
            'organization_id', 'project_id', 'api_key_name', 'event_id', 'span_id', 'trace_id', 'parent_span_id',
            'span_kind', 'span_type', 'span_status', 'is_root_span', 'is_http_span', 'is_db_span', 'is_cache_span', 'is_messaging_span',
            'name', 'message', 'endpoint', 'start_time', 'end_time',
            'duration_ms', 'exclusive_duration_ms', 'occurred_at',
            'http_method', 'http_route', 'http_url', 'http_target', 'http_host', 'http_scheme', 'http_flavor',
            'http_status_code', 'http_status_text', 'http_response_size', 'http_user_agent', 'client_ip_hash',
            'net_transport', 'net_host_name', 'net_host_ip', 'net_host_port', 'net_peer_ip', 'net_peer_port',
            'db_system', 'db_name', 'db_operation', 'db_collection', 'db_statement',
            'messaging_system', 'messaging_destination', 'messaging_operation',
            'attributes', 'events', 'links',
            'request_id', 'session_id', 'user_id', 'tenant_id',
            'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'payload', 'ai_response',
            'id', 'public_id', 'created_at', 'ingested_at'
        ];
        const inserted = await insertChunked(db, 'events_spans', cols, rows);
        return { inserted };
    }
    // ── events_traces ─────────────────────────────────────────────────────────
    async writeTraces(list, db) {
        return this.writeTracesInTransaction(list, db);
    }
    async writeTracesInTransaction(list, db) {
        const rows = list.map(({ projectId, orgId, environment, apiKeyName, occurredAtMs, event }) => {
            const e = event;
            const r = rec(event);
            const root = plainObject(e.rootSpan) ?? {};
            const metadata = metadataFor(event, environment);
            const rootAttrs = plainObject(root.attributes);
            const endpoint = str(attrValue(rootAttrs, 'http.route'), 500) ?? str(attrValue(rootAttrs, 'route'), 500);
            const httpMethod = str(attrValue(rootAttrs, 'http.method'), 10);
            const statusCode = num(attrValue(rootAttrs, 'http.status_code'));
            const responseSize = num(attrValue(rootAttrs, 'http.response.body.size'));
            const rootSpanId = str(root.spanId ?? root.id, 64);
            const parentSpanId = str(root.parentSpanId ?? root.parentId, 64);
            const headers = plainObject(r.headers) ?? {};
            const rawUserAgent = r.userAgent ?? r.user_agent ?? headers['user-agent'] ?? headers['User-Agent'] ?? attrValue(rootAttrs, 'http.user_agent') ?? null;
            const rawClientIp = r.clientIp ?? r.client_ip ?? headers['x-forwarded-for'] ?? headers['X-Forwarded-For'] ?? attrValue(rootAttrs, 'http.client_ip') ?? null;
            const occurredAt = iso(resolveScopedTimestamp(event, occurredAtMs));
            return [
                orgId, projectId, apiKeyName ?? '', this.eventId(event), e.traceId, rootSpanId, parentSpanId,
                str(root.name, 500), rootSpanId, str(root.kind, 32), spanStatus(root.status), endpoint, httpMethod, statusCode,
                num(root.duration) ?? 0, num(e.totalDuration) ?? 0, responseSize, e.spanCount ?? 0, e.isPartial ?? false,
                e.rootSpan != null ? JSON.stringify(e.rootSpan) : null,
                e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255), str(r.tenantId, 255),
                str(r.service, 100), environment, str(metadataField(metadata, event, 'release'), 100),
                str(metadataField(metadata, event, 'serverName'), 100), str(metadataField(metadata, event, 'applicationName'), 100), str(metadataField(metadata, event, 'applicationVersion'), 50),
                str(metadataField(metadata, event, 'sdkName'), 50), str(metadataField(metadata, event, 'sdkVersion'), 50), JSON.stringify(traceAttributes(event)), JSON.stringify(metadata), occurredAt,
                str(rawUserAgent, 1024), str(rawClientIp, 255),
                payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
                uuidv7(), generatePublicId(PUBLIC_ID_PREFIXES.traces), new Date().toISOString(), new Date().toISOString(),
            ];
        });
        const { text, values } = buildInsert('events_traces', ['organization_id', 'project_id', 'api_key_name', 'event_id', 'trace_id', 'span_id', 'parent_span_id',
            'root_span_name', 'root_span_id', 'span_kind', 'root_span_status', 'endpoint', 'http_method', 'status_code',
            'duration_ms', 'total_duration_ms', 'response_size', 'span_count', 'is_partial',
            'spans_tree', 'request_id', 'session_id', 'user_id', 'tenant_id',
            'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
            'sdk_name', 'sdk_version', 'attributes', 'metadata', 'occurred_at',
            'user_agent', 'client_ip_hash', 'payload', 'ai_response',
            'id', 'public_id', 'created_at', 'ingested_at'], rows);
        const res = await db.query(text, values);
        await this.writeTraceSpanTree(list, db);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_metrics ─────────────────────────────────────────────────────────
    async writeTraceSpanTree(list, db) {
        const columns = [
            'organization_id', 'project_id', 'api_key_name', 'event_id', 'span_id', 'trace_id', 'parent_span_id',
            'name', 'span_kind', 'span_type', 'span_status', 'message', 'endpoint',
            'is_root_span', 'is_http_span', 'is_db_span', 'is_cache_span', 'is_messaging_span',
            'start_time', 'end_time', 'duration_ms', 'exclusive_duration_ms', 'occurred_at',
            'attributes', 'events', 'links', 'depth',
            'http_method', 'http_route', 'http_url', 'http_target', 'http_host', 'http_scheme', 'http_flavor',
            'http_status_code', 'http_status_text', 'http_response_size', 'http_user_agent', 'client_ip_hash',
            'net_transport', 'net_host_name', 'net_host_ip', 'net_host_port', 'net_peer_ip', 'net_peer_port',
            'db_system', 'db_name', 'db_operation', 'db_collection', 'db_statement',
            'messaging_system', 'messaging_destination', 'messaging_operation',
            'request_id', 'session_id', 'user_id', 'tenant_id',
            'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
            'sdk_name', 'sdk_version', 'metadata', 'payload',
            'id', 'public_id', 'created_at', 'ingested_at',
        ];
        const maxRowsPerStatement = Math.max(1, Math.floor(PG_MAX_BIND_PARAMS / columns.length));
        let rows = [];
        const flush = async () => {
            if (rows.length === 0)
                return;
            const pending = rows;
            rows = [];
            await insertChunked(db, 'events_spans', columns, pending);
        };
        for (const scoped of list) {
            const event = scoped.event;
            const timestamp = iso(resolveScopedTimestamp(scoped.event, scoped.occurredAtMs));
            const visited = new WeakSet();
            let nodeCount = 0;
            const stack = [
                { span: event.rootSpan, parentSpanId: null, depth: 0 },
            ];
            while (stack.length > 0) {
                const current = stack.pop();
                const span = plainObject(current.span);
                if (!span)
                    continue;
                if (visited.has(span)) {
                    throw new Error('TRACE_TREE_INVARIANT_VIOLATION: cycle or shared span reference');
                }
                visited.add(span);
                nodeCount += 1;
                if (nodeCount > LIMITS.maxTraceSpanCount || current.depth > LIMITS.maxTraceSpanDepth) {
                    throw new Error('TRACE_TREE_INVARIANT_VIOLATION: trace bounds exceeded');
                }
                const built = this.buildTraceSpanRow(scoped, span, current.parentSpanId, current.depth, timestamp);
                if (!built)
                    continue;
                rows.push(built.row);
                if (rows.length >= maxRowsPerStatement)
                    await flush();
                const childrenValue = Object.prototype.hasOwnProperty.call(span, 'children')
                    ? span.children
                    : undefined;
                if (childrenValue !== undefined && !Array.isArray(childrenValue)) {
                    throw new Error('TRACE_TREE_INVARIANT_VIOLATION: children must be an array');
                }
                const children = Array.isArray(childrenValue) ? childrenValue : [];
                if (children.length > 0 && current.depth >= LIMITS.maxTraceSpanDepth) {
                    throw new Error('TRACE_TREE_INVARIANT_VIOLATION: trace depth exceeded');
                }
                for (let index = children.length - 1; index >= 0; index -= 1) {
                    stack.push({
                        span: children[index],
                        parentSpanId: built.spanId,
                        depth: current.depth + 1,
                    });
                }
            }
        }
        await flush();
    }
    buildTraceSpanRow(scoped, span, parentSpanId, depth, timestamp) {
        const event = scoped.event;
        const metadata = metadataFor(event, scoped.environment);
        const spanId = str(span.spanId ?? span.id, 64);
        if (!spanId)
            return null;
        const attrs = plainObject(span.attributes) ?? {};
        const eventId = `${this.eventId(event)}:${spanId}`.slice(0, 64);
        const kind = spanKind(span.kind);
        const status = spanStatus(span.status);
        const name = str(span.name, 500) ?? spanId;
        const endpoint = str(attrValue(attrs, 'http.route') ?? attrValue(attrs, 'route'), 500);
        const spanType = classifySpan(kind, name, attrs);
        const isHttp = spanType === 'http';
        const isDb = spanType === 'database';
        const isCache = spanType === 'cache';
        const isMessaging = ['messaging', 'queue', 'producer', 'consumer'].includes(spanType);
        const rawStartTime = span.startTime ?? span.start_time ?? span.timestamp ?? span.time ?? span.start;
        const startTimeIso = parseSafeIsoTimestamp(rawStartTime, {
            traceId: event.traceId,
            spanId,
            field: 'startTime',
            logger: this.log,
        });
        const rawEndTime = span.endTime ?? span.end_time ?? span.end;
        let endTimeIso = parseSafeIsoTimestamp(rawEndTime, {
            traceId: event.traceId,
            spanId,
            field: 'endTime',
            logger: this.log,
        });
        if (endTimeIso == null && rawStartTime != null && span.duration != null) {
            const startMs = parseSafeEpochMs(rawStartTime);
            const durMs = num(span.duration);
            if (startMs != null && durMs != null && durMs >= 0) {
                endTimeIso = parseSafeIsoTimestamp(startMs + durMs, {
                    traceId: event.traceId,
                    spanId,
                    field: 'endTime (derived)',
                    logger: this.log,
                });
            }
        }
        const spanOccurredAt = startTimeIso ?? timestamp;
        return {
            spanId,
            row: [
                scoped.orgId, scoped.projectId, scoped.apiKeyName ?? '', eventId, spanId, event.traceId, parentSpanId,
                name, kind, spanType, status, str(span.statusMessage, 1024), endpoint,
                parentSpanId == null, isHttp, isDb, isCache, isMessaging,
                startTimeIso,
                endTimeIso,
                num(span.duration), num(span.exclusiveDuration), spanOccurredAt, JSON.stringify(normalizedSpanAttributes(attrs)),
                span.events != null ? JSON.stringify(span.events) : JSON.stringify([]),
                span.links != null ? JSON.stringify(span.links) : JSON.stringify([]),
                depth,
                str(attrValue(attrs, 'http.method'), 10), str(attrValue(attrs, 'http.route'), 500),
                str(attrValue(attrs, 'http.url'), 8192), str(attrValue(attrs, 'http.target'), 2048),
                str(attrValue(attrs, 'http.host'), 255), str(attrValue(attrs, 'http.scheme'), 32), str(attrValue(attrs, 'http.flavor'), 32),
                num(attrValue(attrs, 'http.status_code')), str(attrValue(attrs, 'http.status_text'), 255),
                num(attrValue(attrs, 'http.response.body.size')), str(attrValue(attrs, 'http.user_agent'), 1024), str(attrValue(attrs, 'http.client_ip'), 255),
                str(attrValue(attrs, 'net.transport'), 64), str(attrValue(attrs, 'net.host.name'), 255), str(attrValue(attrs, 'net.host.ip'), 255),
                num(attrValue(attrs, 'net.host.port')), resolvePeerAddress(attrs, attrValue(attrs, 'net.peer.ip')), resolvePeerPort(attrs, attrValue(attrs, 'net.peer.port')),
                resolveDbSystem(attrs), resolveDbName(attrs), resolveDbOperation(attrs),
                resolveDbCollection(attrs), resolveDbStatement(attrs),
                str(attrValue(attrs, 'messaging.system'), 50), str(attrValue(attrs, 'messaging.destination'), 255), str(attrValue(attrs, 'messaging.operation'), 50),
                event.requestId ?? str(attrValue(attrs, 'pulse.request_id'), 255), event.sessionId ?? null, str(rec(event).userId, 255),
                str(rec(event).tenantId, 255) ?? str(attrValue(attrs, 'pulse.tenant_id'), 255),
                str(rec(event).service, 100), scoped.environment, str(metadataField(metadata, event, 'release'), 100),
                str(metadataField(metadata, event, 'serverName'), 100), str(metadataField(metadata, event, 'applicationName'), 100), str(metadataField(metadata, event, 'applicationVersion'), 50),
                str(metadataField(metadata, event, 'sdkName'), 50), str(metadataField(metadata, event, 'sdkVersion'), 50),
                JSON.stringify(metadata), payloadFor(event),
                uuidv7(), generatePublicId(PUBLIC_ID_PREFIXES.spans), new Date().toISOString(), new Date().toISOString(),
            ],
        };
    }
    async writeMetrics(list, db) {
        const rows = list.map(({ projectId, orgId, environment, apiKeyName, occurredAtMs, event }) => {
            const e = event;
            const r = rec(event);
            const tags = plainObject(e.tags) ?? {};
            const metadata = metadataFor(event, environment);
            // Resolve metric_unit from canonical SDK field first, then legacy 'unit'
            const metricUnit = str(e.metricUnit ?? e.unit ?? r.metricUnit ?? r.unit, 50);
            // Promote HTTP context out of tags (no JSON parsing at query time)
            const endpoint = str(tagValue(tags, 'path', 'route', 'endpoint', 'http.route'), 500);
            const httpMethod = str(tagValue(tags, 'method', 'http.method', 'http_method'), 10);
            const statusCode = num(tagValue(tags, 'status', 'statusCode', 'status_code', 'http.status_code'));
            // Automatic classification — no JSON at dashboard query time
            const metricCategory = str(r.metricCategory, 50) ?? classifyMetric(e.metricName, e.metricType, tags);
            const aggType = str(r.aggregationType, 50) ?? aggregationType(e.metricType);
            // Percentiles: prefer SDK-supplied values, resolved from both camelCase and snake_case
            const p50 = num(e.p50 ?? r.p50);
            const p75 = num(e.p75 ?? r.p75);
            const p90 = num(e.p90 ?? r.p90);
            const p95 = num(e.p95 ?? r.p95);
            const p99 = num(e.p99 ?? r.p99);
            return [
                // identity
                orgId, projectId, apiKeyName ?? '', this.eventId(event),
                // metric identity
                e.metricName, e.metricType,
                metricUnit, str(e.metricNamespace ?? r.metricNamespace, 255), str(e.metricDescription ?? r.metricDescription, 1024),
                // numeric value + aggregates
                num(e.value) ?? 0,
                num(e.count), num(e.sum), num(e.min), num(e.max), num(e.avg),
                num(e.rate ?? r.rate),
                e.buckets != null ? JSON.stringify(e.buckets) : null,
                p50, p75, p90, p95, p99,
                // classification
                metricCategory, aggType,
                str(e.temporality ?? r.temporality, 32),
                typeof e.isMonotonic === 'boolean' ? e.isMonotonic : (typeof r.isMonotonic === 'boolean' ? r.isMonotonic : null),
                // promoted HTTP context from tags
                endpoint, httpMethod, statusCode,
                // correlation IDs
                e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null,
                str(r.userId, 255), str(e.tenantId ?? r.tenantId, 255),
                // SDK origin
                str(r.service, 100), environment,
                str(metadataField(metadata, event, 'release'), 100),
                str(metadataField(metadata, event, 'serverName'), 100),
                str(metadataField(metadata, event, 'applicationName'), 100),
                str(metadataField(metadata, event, 'applicationVersion'), 50),
                str(metadataField(metadata, event, 'sdkName'), 50),
                str(metadataField(metadata, event, 'sdkVersion'), 50),
                // raw tags (full JSONB), clean attributes (custom-only), debug copies
                JSON.stringify(e.tags ?? {}),
                JSON.stringify(metricAttributes(event)),
                JSON.stringify(metadata),
                iso(resolveScopedTimestamp(event, occurredAtMs)),
                payloadFor(event),
                e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
                uuidv7(), generatePublicId(PUBLIC_ID_PREFIXES.metrics), new Date().toISOString(), new Date().toISOString(),
            ];
        });
        const { text, values } = buildInsert('events_metrics', [
            'organization_id', 'project_id', 'api_key_name', 'event_id',
            // metric identity
            'metric_name', 'metric_type',
            'metric_unit', 'metric_namespace', 'metric_description',
            // numeric value + aggregates
            'value',
            'count', 'sum', 'min', 'max', 'avg',
            'rate', 'buckets',
            'p50', 'p75', 'p90', 'p95', 'p99',
            // classification
            'metric_category', 'aggregation_type', 'temporality', 'is_monotonic',
            // promoted HTTP context
            'endpoint', 'http_method', 'status_code',
            // correlation IDs
            'trace_id', 'span_id', 'request_id', 'session_id',
            'user_id', 'tenant_id',
            // SDK origin
            'service', 'environment', 'release', 'server_name',
            'application_name', 'application_version',
            'sdk_name', 'sdk_version',
            // JSONB
            'tags', 'attributes', 'metadata', 'occurred_at', 'payload', 'ai_response',
            'id', 'public_id', 'created_at', 'ingested_at'
        ], rows);
        const res = await db.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_logs ─────────────────────────────────────────────────────────
    async writeLogs(list, db) {
        const rows = list.map(({ projectId, orgId, environment, apiKeyName, occurredAtMs, event }) => {
            const e = event;
            const r = rec(event);
            const metadata = metadataFor(event, environment);
            const msg = e.message ?? '';
            const c = plainObject(e.context) ?? {};
            const httpC = plainObject(c.http) ?? {};
            // ── Extraction logic ──────────────────────────────────────────────────────
            const httpMethod = e.httpMethod ?? str(httpC.method, 16) ?? (msg.match(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+/)?.[1]) ?? null;
            const endpoint = e.endpoint ?? str(httpC.url, 2048) ?? (msg.match(/^(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+([^?\s]+)/)?.[1]) ?? null;
            let statusCode = e.statusCode ?? num(httpC.status_code);
            if (statusCode == null) {
                const sc1 = msg.match(/HTTP.*?\s([2-5][0-9]{2})\b/)?.[1];
                if (sc1)
                    statusCode = Number(sc1);
                else {
                    const sc2 = msg.match(/\b([2-5][0-9]{2})\b.*?\s\d+ms/)?.[1];
                    if (sc2)
                        statusCode = Number(sc2);
                }
            }
            let durationMs = e.durationMs ?? num(httpC.duration_ms);
            if (durationMs == null) {
                const d = msg.match(/\b(\d+)\s*ms\b/)?.[1];
                if (d)
                    durationMs = Number(d);
            }
            // ── Categorization ────────────────────────────────────────────────────────
            const loggerName = str(e.loggerName ?? r.loggerName ?? e.logger, 255) ?? 'unknown';
            const loggerLower = loggerName.toLowerCase();
            const msgLower = msg.toLowerCase();
            const name = str(e.name, 255) ?? (msg.match(/^(GET|POST|PUT|DELETE|PATCH)\s+/) ? 'HTTP Request' :
                (msgLower.includes('error') || e.level === 'error' || e.level === 'fatal') ? 'Error Log' :
                    (loggerLower.includes('db') || loggerLower.includes('postgres')) ? 'Database Query' :
                        (loggerLower.includes('cache') || loggerLower.includes('redis')) ? 'Cache Operation' :
                            (loggerLower.includes('worker') || loggerLower.includes('job') || loggerLower.includes('queue')) ? 'Background Job' :
                                'Log Event');
            const logSource = e.logSource ?? (e.sdkName != null ? 'sdk' :
                (loggerLower.includes('express') || loggerLower.includes('koa') || loggerLower.includes('fastify')) ? 'framework' :
                    loggerLower.includes('middleware') ? 'middleware' :
                        (loggerLower.includes('worker') || loggerLower.includes('job')) ? 'worker' :
                            'unknown');
            const logCategory = e.logCategory ?? ((msgLower.includes('get ') || msgLower.includes('post ') || loggerLower.includes('http')) ? 'http' :
                (loggerLower.includes('db') || loggerLower.includes('sql') || loggerLower.includes('postgres')) ? 'database' :
                    (loggerLower.includes('redis') || loggerLower.includes('cache')) ? 'cache' :
                        (loggerLower.includes('auth') || msgLower.includes('login') || msgLower.includes('unauthorized')) ? 'authentication' :
                            (loggerLower.includes('queue') || loggerLower.includes('worker')) ? 'worker' :
                                (e.level === 'error' || e.level === 'fatal' || msgLower.includes('exception')) ? 'application' :
                                    'application');
            // Clean attributes
            const rawAttrs = plainObject(e.attributes) ?? {};
            const LOG_ATTR_DUPES = new Set([
                'parentSpanId', 'parent_span_id', 'tenantId', 'tenant_id',
                'name', 'loggerName', 'logger_name', 'logSource', 'log_source',
                'logCategory', 'log_category', 'endpoint', 'httpMethod', 'http_method',
                'statusCode', 'status_code', 'durationMs', 'duration_ms',
                'environment', 'projectId', 'project_id', 'organizationId', 'organization_id',
                'sdkName', 'sdk_name', 'sdkVersion', 'sdk_version',
                'applicationName', 'application_name', 'applicationVersion', 'application_version',
                'release', 'timestamp', 'eventId', 'event_id',
                'requestId', 'request_id', 'sessionId', 'session_id',
                'traceId', 'trace_id', 'spanId', 'span_id', 'level', 'message'
            ]);
            const cleanAttributes = {};
            for (const [k, v] of Object.entries(rawAttrs)) {
                if (!LOG_ATTR_DUPES.has(k))
                    cleanAttributes[k] = v;
            }
            const extra = plainObject(r.extra);
            if (extra) {
                for (const [k, v] of Object.entries(extra)) {
                    if (!LOG_ATTR_DUPES.has(k))
                        cleanAttributes[k] = v;
                }
            }
            return [
                orgId, projectId, apiKeyName ?? '', this.eventId(event), logLevel(e.level), msg,
                JSON.stringify(e.args ?? []), e.traceId ?? null, e.spanId ?? null,
                str(e.parentSpanId ?? r.parentSpanId, 128), str(e.tenantId ?? r.tenantId, 255),
                name, loggerName, logSource, logCategory, endpoint, httpMethod, statusCode, durationMs,
                e.requestId ?? null, e.sessionId ?? null,
                str(r.service, 100), environment, str(metadataField(metadata, event, 'release'), 100),
                str(metadataField(metadata, event, 'serverName'), 100), str(metadataField(metadata, event, 'applicationName'), 100), str(metadataField(metadata, event, 'applicationVersion'), 50),
                str(r.userId, 255), inet(r.userIp),
                str(metadataField(metadata, event, 'sdkName'), 50), str(metadataField(metadata, event, 'sdkVersion'), 50),
                JSON.stringify(c), JSON.stringify(e.tags ?? {}), JSON.stringify(cleanAttributes),
                JSON.stringify(metadata), iso(resolveScopedTimestamp(event, occurredAtMs)),
                payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
                uuidv7(), generatePublicId(PUBLIC_ID_PREFIXES.logs), new Date().toISOString(), new Date().toISOString(),
            ];
        });
        const cols = [
            'organization_id', 'project_id', 'api_key_name', 'event_id', 'level', 'message',
            'args', 'trace_id', 'span_id', 'parent_span_id', 'tenant_id',
            'name', 'logger_name', 'log_source', 'log_category', 'endpoint', 'http_method', 'status_code', 'duration_ms',
            'request_id', 'session_id',
            'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
            'user_id', 'user_ip',
            'sdk_name', 'sdk_version', 'context', 'tags', 'attributes',
            'metadata', 'occurred_at', 'payload', 'ai_response',
            'id', 'public_id', 'created_at', 'ingested_at'
        ];
        const inserted = await insertChunked(db, 'events_logs', cols, rows);
        return { inserted };
    }
    // ── events_profiles ─────────────────────────────────────────────────────────
    async writeProfiles(list, db) {
        const rows = list.map(({ projectId, orgId, environment, apiKeyName, occurredAtMs, event }) => {
            const e = event;
            const r = rec(event);
            const ts = resolveScopedTimestamp(event, occurredAtMs);
            const metadata = metadataFor(event, environment);
            return [
                orgId, projectId, apiKeyName ?? '', this.eventId(event), str(e.profileType, 20) ?? 'cpu',
                e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255),
                parseSafeIsoTimestamp(e.startTime, { traceId: e.traceId, spanId: e.spanId, field: 'startTime', logger: this.log }) ?? iso(ts),
                parseSafeIsoTimestamp(e.endTime, { traceId: e.traceId, spanId: e.spanId, field: 'endTime', logger: this.log }), num(e.duration),
                e.profile != null ? JSON.stringify(e.profile) : null,
                str(r.service, 100), environment, str(metadataField(metadata, event, 'release'), 100),
                str(metadataField(metadata, event, 'serverName'), 100), str(metadataField(metadata, event, 'applicationName'), 100), str(metadataField(metadata, event, 'applicationVersion'), 50),
                str(metadataField(metadata, event, 'sdkName'), 50), str(metadataField(metadata, event, 'sdkVersion'), 50), JSON.stringify(metadata), iso(ts),
                payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
                uuidv7(), generatePublicId(PUBLIC_ID_PREFIXES.profiles), new Date().toISOString(), new Date().toISOString(),
            ];
        });
        const { text, values } = buildInsert('events_profiles', ['organization_id', 'project_id', 'api_key_name', 'event_id', 'profile_type',
            'trace_id', 'span_id', 'request_id', 'session_id', 'user_id', 'start_time', 'end_time', 'duration_ms',
            'profile_data', 'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'occurred_at', 'payload', 'ai_response',
            'id', 'public_id', 'created_at', 'ingested_at'], rows);
        const res = await db.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_cron_checkins ─────────────────────────────────────────────────────
    async writeCronCheckins(list, db) {
        const rows = list.map(({ projectId, orgId, environment, apiKeyName, occurredAtMs, event }) => {
            const e = event;
            const r = rec(event);
            const metadata = metadataFor(event, environment);
            // Derived: is_success
            const isSuccess = e.status === 'ok';
            // Derived: checkin_type — auto-classify if SDK doesn't supply it
            const checkinType = str(e.checkinType ?? r.checkinType, 32)
                ?? (e.monitorSlug && (e.monitorSlug.includes('heartbeat') || e.monitorSlug.includes('ping')) ? 'heartbeat'
                    : e.scheduleType ?? r.scheduleType ? 'scheduled'
                        : 'scheduled');
            // Clean attributes: remove all fields that have canonical columns
            const rawAttrs = plainObject(e.attributes) ?? {};
            const CRON_ATTR_DUPES = new Set([
                'monitorSlug', 'monitor_slug', 'monitorName', 'monitor_name',
                'status', 'duration', 'duration_ms',
                'checkinType', 'checkin_type', 'scheduleType', 'schedule_type',
                'startedAt', 'started_at', 'finishedAt', 'finished_at',
                'isSuccess', 'is_success', 'tenantId', 'tenant_id',
                'environment', 'projectId', 'project_id', 'organizationId', 'organization_id',
                'sdkName', 'sdk_name', 'sdkVersion', 'sdk_version',
                'applicationName', 'application_name', 'applicationVersion', 'application_version',
                'release', 'timestamp', 'eventId', 'event_id',
                'requestId', 'request_id', 'sessionId', 'session_id',
                'traceId', 'trace_id', 'spanId', 'span_id',
            ]);
            const cleanAttributes = {};
            for (const [k, v] of Object.entries(rawAttrs)) {
                if (!CRON_ATTR_DUPES.has(k))
                    cleanAttributes[k] = v;
            }
            // Merge extra object into attributes (custom business data)
            const extra = plainObject(r.extra);
            if (extra) {
                for (const [k, v] of Object.entries(extra)) {
                    if (!CRON_ATTR_DUPES.has(k))
                        cleanAttributes[k] = v;
                }
            }
            return [
                // identity
                orgId, projectId, apiKeyName ?? '', this.eventId(event),
                // monitor
                e.monitorSlug, str(e.monitorName ?? r.monitorName, 255),
                // status + derived
                e.status, isSuccess,
                // timing
                num(e.duration),
                parseSafeIsoTimestamp(e.startedAt, { traceId: e.traceId, spanId: e.spanId, field: 'startedAt', logger: this.log }),
                parseSafeIsoTimestamp(e.finishedAt, { traceId: e.traceId, spanId: e.spanId, field: 'finishedAt', logger: this.log }),
                // classification
                checkinType, str(e.scheduleType ?? r.scheduleType, 64),
                // correlation IDs
                e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null,
                str(r.userId, 255), str(e.tenantId ?? r.tenantId, 255),
                // SDK origin
                str(r.service, 100), environment,
                str(metadataField(metadata, event, 'release'), 100),
                str(metadataField(metadata, event, 'serverName'), 100),
                str(metadataField(metadata, event, 'applicationName'), 100),
                str(metadataField(metadata, event, 'applicationVersion'), 50),
                str(metadataField(metadata, event, 'sdkName'), 50),
                str(metadataField(metadata, event, 'sdkVersion'), 50),
                // JSONB
                JSON.stringify(e.tags ?? {}),
                JSON.stringify(cleanAttributes),
                JSON.stringify(metadata),
                iso(resolveScopedTimestamp(event, occurredAtMs)),
                payloadFor(event),
                e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
                uuidv7(), generatePublicId(PUBLIC_ID_PREFIXES.cronCheckins), new Date().toISOString(), new Date().toISOString(),
            ];
        });
        const { text, values } = buildInsert('events_cron_checkins', [
            'organization_id', 'project_id', 'api_key_name', 'event_id',
            // monitor
            'monitor_slug', 'monitor_name',
            // status
            'status', 'is_success',
            // timing
            'duration_ms', 'started_at', 'finished_at',
            // classification
            'checkin_type', 'schedule_type',
            // correlation IDs
            'trace_id', 'span_id', 'request_id', 'session_id',
            'user_id', 'tenant_id',
            // SDK origin
            'service', 'environment', 'release', 'server_name',
            'application_name', 'application_version',
            'sdk_name', 'sdk_version',
            // JSONB
            'tags', 'attributes', 'metadata', 'occurred_at', 'payload', 'ai_response',
            'id', 'public_id', 'created_at', 'ingested_at'
        ], rows);
        const res = await db.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_replays ─────────────────────────────────────────────────────────
    async writeReplays(list, db) {
        const rows = list.map(({ projectId, orgId, environment, apiKeyName, occurredAtMs, event }) => {
            const e = event;
            const r = rec(event);
            const metadata = metadataFor(event, environment);
            return [
                orgId, projectId, apiKeyName ?? '', this.eventId(event), e.sessionId, e.segmentId,
                JSON.stringify(e.events ?? []),
                e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, str(r.userId, 255),
                str(r.service, 100), environment, str(metadataField(metadata, event, 'release'), 100),
                str(metadataField(metadata, event, 'serverName'), 100), str(metadataField(metadata, event, 'applicationName'), 100), str(metadataField(metadata, event, 'applicationVersion'), 50),
                str(metadataField(metadata, event, 'sdkName'), 50), str(metadataField(metadata, event, 'sdkVersion'), 50), JSON.stringify(metadata), iso(resolveScopedTimestamp(event, occurredAtMs)),
                payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
                uuidv7(), generatePublicId(PUBLIC_ID_PREFIXES.replays), new Date().toISOString(), new Date().toISOString(),
            ];
        });
        const { text, values } = buildInsert('events_replays', ['organization_id', 'project_id', 'api_key_name', 'event_id', 'session_id', 'segment_id',
            'events', 'trace_id', 'span_id', 'request_id', 'user_id',
            'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'occurred_at', 'payload', 'ai_response',
            'id', 'public_id', 'created_at', 'ingested_at'], rows);
        const res = await db.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
}
function outboxSeverity(event) {
    if (event.type === 'error')
        return eventSeverity(event.severity, 'error');
    if (event.type === 'message')
        return eventSeverity(event.severity, 'info');
    if (event.type === 'log')
        return logLevel(event.level) === 'error' ? 'error' : 'info';
    return null;
}
function isFastPathSignal(scoped) {
    const event = scoped.event;
    const record = rec(event);
    if (event.type === 'error')
        return true;
    if (event.type === 'cron_checkin')
        return record.status === 'error';
    if (event.type === 'log') {
        const message = typeof record.message === 'string' ? record.message : '';
        return /out of memory|heap out of memory|oom|security|csrf|xss|sql injection|auth bypass/i.test(message);
    }
    if (event.type === 'request') {
        const status = Number(record.statusCode ?? record.status_code);
        const duration = Number(record.latency ?? record.latencyMs ?? record.latency_ms ?? record.durationMs ?? record.duration_ms ?? record.duration);
        return status === 401
            || status === 403
            || status >= 400
            || (Number.isFinite(duration) && duration >= env.INGESTION_FAST_REQUEST_MIN_DURATION_MS);
    }
    return false;
}
//# sourceMappingURL=telemetry-writer.js.map