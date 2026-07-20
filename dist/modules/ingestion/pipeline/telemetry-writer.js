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
 *     events. `RETURNING` keeps rowCount truthful: callers learn how many rows
 *     were ACTUALLY inserted (duplicates excluded).
 *   - Rollups (analytics_hourly_rollup / analytics_error_groups) are owned by
 *     the event-analytics worker and the ingestion event-processor, NOT
 *     written here — this writer only persists raw events.
 */
import { randomUUID } from 'crypto';
import { resolveTimestamp } from './event-normalizer.js';
function iso(ms) {
    return new Date(ms).toISOString();
}
/** Cast a normalized event to a loose record for passthrough field access. */
function rec(ev) {
    return ev;
}
/** Safe optional string with a max length, else null. */
function str(v, max = 255) {
    return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}
/** Safe optional finite number, else null. */
function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
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
/** Storage error_name for an error event (shared with the error grouper). */
export function errorNameOf(event) {
    const name = event.name;
    return typeof name === 'string' && name.length > 0 ? name.slice(0, 256) : 'UnknownError';
}
/**
 * Storage fingerprint for an error event (shared with the error grouper so
 * events_errors.fingerprint and analytics_error_groups.fingerprint agree).
 */
export function errorFingerprint(event, errorName = errorNameOf(event)) {
    const e = event;
    const explicit = typeof e.fingerprint === 'string' && e.fingerprint.length > 0 ? e.fingerprint : null;
    return (explicit ?? `auto:${errorName}:${e.message.slice(0, 48)}`).slice(0, 64);
}
/** Build a parameterized multi-row INSERT. JSONB values are passed as JSON text
 * (unknown→jsonb coercion handles the cast in an INSERT ... VALUES context).
 * ON CONFLICT DO NOTHING (no column target) makes the insert idempotent
 * against the (project_id, event_id) identity indexes; RETURNING keeps
 * rowCount truthful — it counts only ACTUALLY inserted rows. */
function buildInsert(table, cols, rows, returning = 'id') {
    const values = [];
    const tuples = [];
    let p = 1;
    for (const row of rows) {
        tuples.push(`(${row.map(() => `$${p++}`).join(', ')})`);
        values.push(...row);
    }
    return {
        text: `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING RETURNING ${returning}`,
        values,
    };
}
export class TelemetryWriter {
    pool;
    constructor(pool) {
        this.pool = pool;
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
            const res = await this.writeTyped(type, list);
            result.perType[type] = { received: list.length, inserted: res.inserted };
            result.totalReceived += list.length;
            result.totalInserted += res.inserted;
            if (res.insertedErrors)
                result.insertedErrors.push(...res.insertedErrors);
        }
        return result;
    }
    async writeTyped(type, list) {
        switch (type) {
            case 'error': return this.writeErrors(list);
            case 'message': return this.writeMessages(list);
            case 'request': return this.writeRequests(list);
            case 'span': return this.writeSpans(list);
            case 'trace': return this.writeTraces(list);
            case 'metric': return this.writeMetrics(list);
            case 'log': return this.writeLogs(list);
            case 'profile': return this.writeProfiles(list);
            case 'cron_checkin': return this.writeCronCheckins(list);
            case 'replay': return this.writeReplays(list);
            default: return { inserted: 0 };
        }
    }
    /** Best-effort event id (events_*.event_id is NOT NULL). */
    eventId(ev) {
        const id = ev.eventId;
        return typeof id === 'string' && id.length > 0 ? id.slice(0, 64) : randomUUID();
    }
    // ── events_errors ─────────────────────────────────────────────────────────
    async writeErrors(list) {
        const ids = list.map(({ event }) => this.eventId(event));
        const rows = list.map(({ projectId, orgId, event }, i) => {
            const e = event;
            const r = rec(event);
            const errorName = errorNameOf(event);
            const fingerprint = errorFingerprint(event, errorName);
            return [
                orgId, projectId, ids[i], fingerprint, e.message,
                errorName, eventSeverity(e.severity, 'error'),
                str(r.stackHash, 64), e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null,
                str(r.source, 100) ?? 'capture', str(r.mechanism, 50), str(r.service, 100),
                str(r.environment, 50), str(r.release, 100), str(r.serverName, 100),
                JSON.stringify(e.stack ?? []), r.sourceContext != null ? JSON.stringify(r.sourceContext) : null,
                str(r.userId, 255), str(r.userEmail, 255), inet(r.userIp),
                JSON.stringify(e.breadcrumbs ?? []),
                JSON.stringify(r.tags ?? {}), JSON.stringify(r.extra ?? {}), JSON.stringify(e.context ?? {}),
                str(r.sdkName, 50), str(r.sdkVersion, 50), iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('events_errors', ['organization_id', 'project_id', 'event_id', 'fingerprint', 'message',
            'error_name', 'severity', 'stack_hash', 'trace_id', 'span_id', 'request_id', 'session_id',
            'source', 'mechanism', 'service', 'environment', 'release', 'server_name',
            'stack_frames', 'source_context', 'user_id', 'user_email', 'user_ip',
            'breadcrumbs', 'tags', 'extra', 'contexts', 'sdk_name', 'sdk_version', 'timestamp'], rows, 'event_id');
        const res = await this.pool.query(text, values);
        // Pair each returned event_id with its first unpaired input occurrence, so
        // a duplicate event_id WITHIN one batch (only the first occurrence inserts)
        // is not double-counted by downstream error grouping.
        const unpaired = new Map();
        for (const row of res.rows)
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
        return { inserted: res.rowCount ?? 0, insertedErrors };
    }
    // ── events_messages ─────────────────────────────────────────────────────────
    async writeMessages(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const r = rec(event);
            return [
                orgId, projectId, this.eventId(event), e.message, eventSeverity(e.severity, 'info'),
                e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null,
                str(r.service, 100), str(r.environment, 50), str(r.release, 100),
                str(r.userId, 255), inet(r.userIp),
                JSON.stringify(r.tags ?? {}), JSON.stringify(e.context ?? {}), JSON.stringify(e.breadcrumbs ?? []),
                str(r.sdkName, 50), str(r.sdkVersion, 50), iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('events_messages', ['organization_id', 'project_id', 'event_id', 'message', 'severity',
            'trace_id', 'span_id', 'request_id', 'session_id',
            'service', 'environment', 'release', 'user_id', 'user_ip',
            'tags', 'contexts', 'breadcrumbs', 'sdk_name', 'sdk_version', 'timestamp'], rows);
        const res = await this.pool.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_requests ─────────────────────────────────────────────────────────
    async writeRequests(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const r = rec(event);
            return [
                orgId, projectId, this.eventId(event), e.requestId, e.url, e.method,
                e.statusCode, Math.round(e.latency), str(r.route, 500), str(r.framework, 50),
                JSON.stringify(e.headers ?? {}), JSON.stringify(e.query ?? {}),
                e.body != null ? JSON.stringify(e.body) : null,
                num(e.bodySize), num(r.responseSize),
                str(r.userId, 255), str(r.tenantId, 255), e.sessionId ?? null,
                inet(r.clientIp), str(r.userAgent, 1024), str(r.referer, 1024),
                e.traceId ?? null, e.spanId ?? null,
                str(r.service, 100), str(r.environment, 50), str(r.release, 100),
                str(r.sdkName, 50), str(r.sdkVersion, 50), iso(resolveTimestamp(event)),
            ];
        });
        // is_slow / is_error are GENERATED columns — do NOT insert them.
        const { text, values } = buildInsert('events_requests', ['organization_id', 'project_id', 'event_id', 'request_id', 'url', 'method',
            'status_code', 'latency_ms', 'route', 'framework', 'headers', 'query_params',
            'body', 'body_size', 'response_size', 'user_id', 'tenant_id', 'session_id',
            'client_ip', 'user_agent', 'referer', 'trace_id', 'span_id',
            'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'timestamp'], rows);
        const res = await this.pool.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_spans ─────────────────────────────────────────────────────────
    async writeSpans(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const r = rec(event);
            return [
                orgId, projectId, this.eventId(event), e.spanId, e.traceId, e.parentSpanId ?? null,
                e.name, spanKind(e.kind), spanStatus(e.status), e.statusMessage ?? null,
                iso(e.startTime), e.endTime != null ? iso(e.endTime) : null,
                num(e.duration), num(e.exclusiveDuration),
                JSON.stringify(e.attributes ?? {}), JSON.stringify(e.events ?? []), JSON.stringify(e.links ?? []),
                str(r.dbSystem, 50), str(r.dbName, 100), str(r.dbOperation, 50), str(r.dbCollection, 100), str(r.dbStatement, 8192),
                str(r.httpMethod, 10), str(r.httpUrl, 8192), num(r.httpStatusCode), str(r.httpHost, 255), str(r.httpRoute, 500),
                str(r.messagingSystem, 50), str(r.messagingDestination, 255), str(r.messagingOperation, 50),
                e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255), str(r.tenantId, 255),
                str(r.service, 100), str(r.environment, 50), str(r.release, 100),
                str(r.sdkName, 50), str(r.sdkVersion, 50), iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('events_spans', ['organization_id', 'project_id', 'event_id', 'span_id', 'trace_id', 'parent_span_id',
            'name', 'kind', 'status', 'status_message', 'start_time', 'end_time',
            'duration_ms', 'exclusive_duration_ms', 'attributes', 'events', 'links',
            'db_system', 'db_name', 'db_operation', 'db_collection', 'db_statement',
            'http_method', 'http_url', 'http_status_code', 'http_host', 'http_route',
            'messaging_system', 'messaging_destination', 'messaging_operation',
            'request_id', 'session_id', 'user_id', 'tenant_id',
            'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'timestamp'], rows);
        const res = await this.pool.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_traces ─────────────────────────────────────────────────────────
    async writeTraces(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const r = rec(event);
            const root = (e.rootSpan ?? {});
            return [
                orgId, projectId, this.eventId(event), e.traceId,
                str(root.name, 500), str(root.spanId ?? root.id, 64),
                e.spanCount, num(e.totalDuration), e.isPartial ?? false,
                e.rootSpan != null ? JSON.stringify(e.rootSpan) : null,
                e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255), str(r.tenantId, 255),
                str(r.service, 100), str(r.environment, 50), str(r.release, 100),
                str(r.sdkName, 50), str(r.sdkVersion, 50), iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('events_traces', ['organization_id', 'project_id', 'event_id', 'trace_id',
            'root_span_name', 'root_span_id', 'span_count', 'total_duration_ms', 'is_partial',
            'spans_tree', 'request_id', 'session_id', 'user_id', 'tenant_id',
            'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'timestamp'], rows);
        const res = await this.pool.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_metrics ─────────────────────────────────────────────────────────
    async writeMetrics(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const r = rec(event);
            return [
                orgId, projectId, this.eventId(event), e.metricName, e.metricType,
                num(e.value) ?? 0, str(e.unit, 50),
                JSON.stringify(e.tags ?? {}), num(e.count), num(e.sum), num(e.min), num(e.max), num(e.avg),
                num(r.rate), e.buckets != null ? JSON.stringify(e.buckets) : null,
                num(r.p50), num(r.p75), num(r.p90), num(r.p95), num(r.p99),
                e.traceId ?? null, e.spanId ?? null, e.requestId ?? null,
                str(r.service, 100), str(r.environment, 50), str(r.release, 100),
                str(r.sdkName, 50), str(r.sdkVersion, 50), iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('events_metrics', ['organization_id', 'project_id', 'event_id', 'metric_name', 'metric_type',
            'value', 'unit', 'tags', 'count', 'sum', 'min', 'max', 'avg',
            'rate', 'buckets', 'p50', 'p75', 'p90', 'p95', 'p99',
            'trace_id', 'span_id', 'request_id', 'service', 'environment', 'release',
            'sdk_name', 'sdk_version', 'timestamp'], rows);
        const res = await this.pool.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_logs ─────────────────────────────────────────────────────────
    async writeLogs(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const r = rec(event);
            return [
                orgId, projectId, this.eventId(event), logLevel(e.level), e.message,
                JSON.stringify(e.args ?? []), e.traceId ?? null, e.spanId ?? null, e.requestId ?? null,
                str(r.service, 100), str(r.environment, 50), str(r.release, 100),
                str(r.userId, 255), inet(r.userIp),
                str(r.sdkName, 50), str(r.sdkVersion, 50), iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('events_logs', ['organization_id', 'project_id', 'event_id', 'level', 'message',
            'args', 'trace_id', 'span_id', 'request_id',
            'service', 'environment', 'release', 'user_id', 'user_ip',
            'sdk_name', 'sdk_version', 'timestamp'], rows);
        const res = await this.pool.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_profiles ─────────────────────────────────────────────────────────
    async writeProfiles(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const r = rec(event);
            const ts = resolveTimestamp(event);
            return [
                orgId, projectId, this.eventId(event), str(e.profileType, 20) ?? 'cpu',
                e.traceId ?? null, e.spanId ?? null, e.requestId ?? null,
                e.startTime != null ? iso(e.startTime) : iso(ts),
                e.endTime != null ? iso(e.endTime) : null, num(e.duration),
                e.profile != null ? JSON.stringify(e.profile) : null,
                str(r.service, 100), str(r.environment, 50), str(r.release, 100),
                str(r.sdkName, 50), str(r.sdkVersion, 50), iso(ts),
            ];
        });
        const { text, values } = buildInsert('events_profiles', ['organization_id', 'project_id', 'event_id', 'profile_type',
            'trace_id', 'span_id', 'request_id', 'start_time', 'end_time', 'duration_ms',
            'profile_data', 'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'timestamp'], rows);
        const res = await this.pool.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_cron_checkins ─────────────────────────────────────────────────────
    async writeCronCheckins(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const r = rec(event);
            return [
                orgId, projectId, this.eventId(event), e.monitorSlug, e.status, num(e.duration),
                str(r.service, 100), str(e.environment, 50), str(r.release, 100),
                str(r.sdkName, 50), str(r.sdkVersion, 50), iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('events_cron_checkins', ['organization_id', 'project_id', 'event_id', 'monitor_slug', 'status', 'duration_ms',
            'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'timestamp'], rows);
        const res = await this.pool.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
    // ── events_replays ─────────────────────────────────────────────────────────
    async writeReplays(list) {
        const rows = list.map(({ projectId, orgId, event }) => {
            const e = event;
            const r = rec(event);
            return [
                orgId, projectId, this.eventId(event), e.sessionId, e.segmentId,
                JSON.stringify(e.events ?? []),
                str(r.service, 100), str(r.environment, 50), str(r.release, 100),
                str(r.sdkName, 50), str(r.sdkVersion, 50), iso(resolveTimestamp(event)),
            ];
        });
        const { text, values } = buildInsert('events_replays', ['organization_id', 'project_id', 'event_id', 'session_id', 'segment_id',
            'events', 'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'timestamp'], rows);
        const res = await this.pool.query(text, values);
        return { inserted: res.rowCount ?? 0 };
    }
}
//# sourceMappingURL=telemetry-writer.js.map