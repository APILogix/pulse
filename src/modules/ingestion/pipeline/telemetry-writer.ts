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
import { STATUS_CODES } from 'http';
import type { Pool, PoolClient } from 'pg';
import type { NormalizedEvent } from './event-normalizer.js';
import { resolveTimestamp } from './event-normalizer.js';
import { RequestEnricher } from './request-enrichment.js';

/** An event paired with the tenant context resolved from its API key. */
export interface ScopedEvent {
  projectId: string;
  /** Organization id — REQUIRED for events_* (organization_id is NOT NULL). */
  orgId: string | null;
  /** Normalized string supplied by the SDK envelope; never an environment UUID. */
  environment: string;
  event: NormalizedEvent;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Cast a normalized event to a loose record for passthrough field access. */
function rec(ev: NormalizedEvent): Record<string, unknown> {
  return ev as unknown as Record<string, unknown>;
}

/** Return the SDK metadata object while making the server-resolved environment authoritative. */
function metadataFor(ev: NormalizedEvent, environment: string): Record<string, unknown> {
  const value = rec(ev).metadata;
  const metadata = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
  metadata.environment = environment;
  return metadata;
}

function sdkMetadataField(ev: NormalizedEvent, environment: string, key: string): unknown {
  const metadata = metadataFor(ev, environment);
  return metadata[key] ?? rec(ev)[key];
}

const REQUEST_ATTRIBUTE_DUPLICATES = new Set([
  'endpoint', 'method', 'duration_ms', 'durationMs', 'latency', 'latency_ms',
  'statusCode', 'status_code', 'responseSize', 'response_size',
  'traceId', 'trace_id', 'spanId', 'span_id', 'requestId', 'request_id',
  'projectId', 'project_id', 'organizationId', 'organization_id',
  'environment', 'applicationName', 'application_name',
  'applicationVersion', 'application_version', 'sdkName', 'sdk_name',
  'sdkVersion', 'sdk_version', 'release', 'timestamp', 'route', 'url',
]);

function requestAttributes(ev: NormalizedEvent): Record<string, unknown> {
  const r = rec(ev);
  const attributes = r.attributes && typeof r.attributes === 'object' && !Array.isArray(r.attributes)
    ? { ...(r.attributes as Record<string, unknown>) }
    : {};
  for (const key of REQUEST_ATTRIBUTE_DUPLICATES) delete attributes[key];
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

function plainObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function attrValue(attrs: Record<string, unknown> | null, path: string): unknown {
  if (!attrs) return undefined;
  if (Object.prototype.hasOwnProperty.call(attrs, path)) return attrs[path];
  return path.split('.').reduce<unknown>((cur, key) => plainObject(cur)?.[key], attrs);
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
] as const;

function deleteAttrPath(attrs: Record<string, unknown>, path: string): void {
  delete attrs[path];
  const parts = path.split('.');
  let cur: Record<string, unknown> | null = attrs;
  const parents: Array<[Record<string, unknown>, string]> = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] as string;
    const next = plainObject(cur?.[key]);
    if (!next) return;
    parents.push([cur, key]);
    cur = next;
  }
  delete cur[parts[parts.length - 1] as string];
  for (let i = parents.length - 1; i >= 0; i--) {
    const [parent, key] = parents[i] as [Record<string, unknown>, string];
    const child = plainObject(parent[key]);
    if (child && Object.keys(child).length === 0) delete parent[key];
  }
}

function normalizedSpanAttributes(attrs: Record<string, unknown> | null): Record<string, unknown> {
  const out = attrs ? { ...attrs } : {};
  for (const path of SPAN_ATTRIBUTE_DUPLICATES) deleteAttrPath(out, path);
  return out;
}

function classifySpan(kind: string | null, name: string | null, attrs: Record<string, unknown> | null): string {
  const n = (name ?? '').toLowerCase();
  const dbSystem = attrValue(attrs, 'db.system');
  const msgSystem = attrValue(attrs, 'messaging.system');
  if (attrValue(attrs, 'http.method') || attrValue(attrs, 'http.route') || attrValue(attrs, 'http.url')) return 'http';
  if (dbSystem) return n.includes('redis') || n.includes('memcache') ? 'cache' : 'database';
  if (msgSystem) return kind === 'producer' ? 'producer' : kind === 'consumer' ? 'consumer' : 'messaging';
  if (n.includes('redis') || n.includes('cache') || n.includes('memcache')) return 'cache';
  if (n.includes('queue')) return 'queue';
  if (n.includes('rpc') || n.includes('grpc')) return 'rpc';
  if (n.includes('cron')) return 'cron';
  if (n.includes('schedule')) return 'scheduler';
  if (kind === 'producer') return 'producer';
  if (kind === 'consumer') return 'consumer';
  if (kind === 'internal') return 'internal';
  return 'unknown';
}

function traceAttributes(ev: NormalizedEvent): Record<string, unknown> {
  const r = rec(ev);
  const attributes = r.attributes && typeof r.attributes === 'object' && !Array.isArray(r.attributes)
    ? { ...(r.attributes as Record<string, unknown>) }
    : {};
  for (const key of TRACE_ATTRIBUTE_DUPLICATES) delete attributes[key];
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
] as const;

function metricAttributes(ev: NormalizedEvent): Record<string, unknown> {
  const attrs = plainObject(rec(ev).attributes);
  const out = attrs ? { ...attrs } : {};
  for (const key of METRIC_ATTRIBUTE_DUPLICATES) deleteAttrPath(out, key);
  return out;
}

function tagValue(tags: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!tags) return undefined;
  for (const key of keys) {
    const value = tags[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function classifyMetric(name: string, type: string, tags: Record<string, unknown> | null): string {
  const n = name.toLowerCase();
  const ns = String(tagValue(tags, 'namespace', 'metric_namespace') ?? '').toLowerCase();
  if (tagValue(tags, 'path', 'route', 'http.route') || tagValue(tags, 'method', 'http.method') || n.startsWith('http.') || n.includes('http.')) return 'http';
  if (n.startsWith('db.') || n.includes('database') || tagValue(tags, 'db.system')) return 'database';
  if (n.includes('redis') || n.includes('cache') || n.includes('memcache')) return 'cache';
  if (n.includes('queue') || tagValue(tags, 'messaging.system')) return 'queue';
  if (n.startsWith('runtime.') || ns === 'runtime') return 'runtime';
  if (n.startsWith('system.') || ns === 'system') return 'system';
  if (n.includes('network') || n.includes('net.')) return 'network';
  if (n.includes('memory') || n.includes('heap') || n.includes('rss')) return 'memory';
  if (n.includes('cpu')) return 'cpu';
  if (n.includes('disk') || n.includes('fs.')) return 'disk';
  if (n.startsWith('business.') || ns === 'business') return 'business';
  if (n.startsWith('app.') || n.startsWith('application.') || type === 'gauge') return 'application';
  return 'custom';
}

function aggregationType(metricType: string): string {
  return ['counter', 'gauge', 'histogram', 'summary', 'observable_counter', 'observable_gauge', 'up_down_counter'].includes(metricType)
    ? metricType
    : 'gauge';
}

/** Preserve the exact normalized SDK event so newly added SDK fields are never lost. */
function payloadFor(ev: NormalizedEvent): string {
  return JSON.stringify(ev);
}

/** Safe optional string with a max length, else null. */
function str(v: unknown, max = 255): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}

/** Safe optional finite number, else null. */
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function httpStatus(v: unknown): number | null {
  const value = num(v);
  return value != null && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/** Basic IPv4/IPv6 validation so an invalid string can't fail an INET insert. */
const IP_RE =
  /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/;
function inet(v: unknown): string | null {
  return typeof v === 'string' && IP_RE.test(v) ? v.slice(0, 45) : null;
}

// ── Enum coercion to the migrations2/004 enum domains ───────────────────────
function eventSeverity(v: unknown, fallback: 'info' | 'error' = 'error'): string {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s === 'debug') return 'debug';
  if (s === 'info' || s === 'information') return 'info';
  if (s === 'warn' || s === 'warning') return 'warning';
  if (s === 'error' || s === 'err') return 'error';
  if (s === 'fatal' || s === 'critical') return 'fatal';
  return fallback;
}
function logLevel(v: unknown): string {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s === 'debug') return 'debug';
  if (s === 'info') return 'info';
  if (s === 'warn' || s === 'warning') return 'warn';
  if (s === 'error' || s === 'err' || s === 'fatal' || s === 'critical') return 'error';
  return 'info';
}
function spanKind(v: unknown): string | null {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return ['internal', 'server', 'client', 'producer', 'consumer'].includes(s) ? s : null;
}
function spanStatus(v: unknown): string {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s === 'ok') return 'ok';
  if (s === 'error' || s === 'err') return 'error';
  return 'unset';
}

function classifyMessageCategory(msg: string | null, tags: Record<string, unknown> | null, logger: string | null, context: Record<string, unknown> | null): string {
  const m = (msg ?? '').toLowerCase();
  const t = tags ?? {};
  const c = context ?? {};
  
  if (t['category'] && typeof t['category'] === 'string') return t['category'];
  if (m.includes('security') || m.includes('unauthorized') || m.includes('forbidden') || t['security'] || c['security']) return 'security';
  if (m.includes('audit') || t['audit'] || c['audit']) return 'audit';
  if (m.includes('http') || m.includes('request') || m.includes('response') || t['http.method']) return 'http';
  if (m.includes('auth') || m.includes('login') || m.includes('logout')) return 'authentication';
  if (m.includes('permission') || m.includes('access')) return 'authorization';
  if (m.includes('database') || m.includes('sql') || m.includes('query') || t['db.system']) return 'database';
  if (m.includes('cache') || m.includes('redis') || m.includes('memcached')) return 'cache';
  if (m.includes('queue') || m.includes('rabbitmq') || m.includes('kafka') || t['messaging.system']) return 'queue';
  if (m.includes('cron') || m.includes('job') || m.includes('schedule') || logger === 'cron') return 'cron';
  if (m.includes('system') || m.includes('memory') || m.includes('cpu') || logger === 'system') return 'system';
  if (m.includes('business') || m.includes('order') || m.includes('payment') || m.includes('invoice')) return 'business';
  
  return 'application';
}

function classifyMessageSource(sdkName: string | null, logger: string | null): string {
  const s = (sdkName ?? '').toLowerCase();
  const l = (logger ?? '').toLowerCase();
  
  if (l === 'manual' || s.includes('manual')) return 'manual';
  if (l.includes('worker') || s.includes('worker')) return 'worker';
  if (l.includes('cron') || l.includes('job')) return 'cron';
  if (l.includes('queue') || l.includes('messaging')) return 'queue';
  if (s.includes('framework') || l.includes('framework')) return 'framework';
  if (s.includes('middleware') || l.includes('middleware')) return 'middleware';
  if (s) return 'sdk';
  
  return 'unknown';
}

/** Storage error_name for an error event (shared with the error grouper). */
export function errorNameOf(event: NormalizedEvent): string {
  const name = (event as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name.slice(0, 256) : 'UnknownError';
}

/**
 * Storage fingerprint for an error event (shared with the error grouper so
 * events_errors.fingerprint and analytics_error_groups.fingerprint agree).
 */
export function errorFingerprint(event: NormalizedEvent, errorName = errorNameOf(event)): string {
  const e = event as Extract<NormalizedEvent, { type: 'error' }>;
  const explicit = typeof e.fingerprint === 'string' && e.fingerprint.length > 0 ? e.fingerprint : null;
  return (explicit ?? `auto:${errorName}:${e.message.slice(0, 48)}`).slice(0, 64);
}

/** Build a parameterized multi-row INSERT. JSONB values are passed as JSON text
 * (unknown→jsonb coercion handles the cast in an INSERT ... VALUES context).
 * ON CONFLICT DO NOTHING (no column target) makes the insert idempotent
 * against the (project_id, event_id) identity indexes; RETURNING keeps
 * rowCount truthful — it counts only ACTUALLY inserted rows. */
function buildInsert(table: string, cols: string[], rows: unknown[][], returning = 'id'): { text: string; values: unknown[] } {
  const timestampIndex = cols.indexOf('timestamp');
  const insertCols = timestampIndex >= 0 && !cols.includes('occurred_at')
    ? [...cols, 'occurred_at']
    : cols;
  const insertRows = insertCols === cols
    ? rows
    : rows.map((row) => [...row, row[timestampIndex]]);
  const values: unknown[] = [];
  const tuples: string[] = [];
  let p = 1;
  for (const row of insertRows) {
    tuples.push(`(${row.map(() => `$${p++}`).join(', ')})`);
    values.push(...row);
  }
  return {
    text: `INSERT INTO ${table} (${insertCols.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING RETURNING ${returning}`,
    values,
  };
}

/** Result of writing one event type. */
export interface TypedWriteResult {
  /** Rows ACTUALLY inserted (delivery duplicates excluded). */
  inserted: number;
  /** Error events confirmed inserted — only set by the errors writer. */
  insertedErrors?: ScopedEvent[];
}

/** Per-batch write outcome with duplicate-aware counts. */
export interface DetailedWriteResult {
  /** Input rows that had a resolvable organization_id. */
  totalReceived: number;
  /** Rows actually inserted across all events_* tables. */
  totalInserted: number;
  perType: Record<string, { received: number; inserted: number }>;
  /** Error events confirmed inserted (drives analytics_error_groups). */
  insertedErrors: ScopedEvent[];
}

type Queryable = Pool | PoolClient;

export class TelemetryWriter {
  private readonly enricher = RequestEnricher.get();

  constructor(private readonly pool: Pool) {}

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
  async writeBatch(scoped: ScopedEvent[]): Promise<number> {
    return (await this.writeBatchDetailed(scoped)).totalInserted;
  }

  /**
   * writeBatch with the full outcome: per-type received/inserted counts and
   * the error events confirmed inserted (for analytics_error_groups). The
   * inserted counts drive usage accounting, so duplicates delivered by
   * at-least-once retries are never billed twice.
   */
  async writeBatchDetailed(scoped: ScopedEvent[]): Promise<DetailedWriteResult> {
    return this.writeBatchDetailedUsing(this.pool, scoped);
  }

  async writeBatchDetailedWithOutbox(client: PoolClient, scoped: ScopedEvent[]): Promise<DetailedWriteResult> {
    const result = await this.writeBatchDetailedUsing(client, scoped);
    if (result.totalInserted > 0) {
      await this.appendTelemetryOutbox(scoped, client);
    }
    return result;
  }

  private async writeBatchDetailedUsing(db: Queryable, scoped: ScopedEvent[]): Promise<DetailedWriteResult> {
    const result: DetailedWriteResult = {
      totalReceived: 0,
      totalInserted: 0,
      perType: {},
      insertedErrors: [],
    };
    if (scoped.length === 0) return result;

    const byType = new Map<string, ScopedEvent[]>();
    for (const s of scoped) {
      if (!s.orgId) continue; // organization_id is NOT NULL in events_*
      const list = byType.get(s.event.type) ?? [];
      list.push(s);
      byType.set(s.event.type, list);
    }

    for (const [type, list] of byType) {
      const res = await this.writeTyped(type, list, db);
      result.perType[type] = { received: list.length, inserted: res.inserted };
      result.totalReceived += list.length;
      result.totalInserted += res.inserted;
      if (res.insertedErrors) result.insertedErrors.push(...res.insertedErrors);
    }
    return result;
  }

  async appendTelemetryOutbox(scoped: ScopedEvent[], db: Queryable = this.pool): Promise<number> {
    const rows = scoped
      .filter((event) => event.orgId !== null)
      .map((event) => {
        const record = rec(event.event);
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
            requestId: str(record.requestId, 64),
            monitorSlug: str(record.monitorSlug, 255),
          }),
          iso(resolveTimestamp(event.event)),
        ];
      });
    if (rows.length === 0) return 0;

    const { text, values } = buildInsert(
      'telemetry_outbox',
      ['organization_id', 'project_id', 'environment', 'signal_kind', 'event_id',
       'severity', 'fast_path', 'attributes', 'occurred_at'],
      rows,
      'id',
    );
    const result = await db.query(text, values);
    return result.rowCount ?? 0;
  }

  private async writeTyped(type: string, list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
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
  private eventId(ev: NormalizedEvent): string {
    const id = (ev as { eventId?: unknown }).eventId;
    return typeof id === 'string' && id.length > 0 ? id.slice(0, 64) : randomUUID();
  }

  // ── events_errors ─────────────────────────────────────────────────────────
  private async writeErrors(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    const ids = list.map(({ event }) => this.eventId(event));
    const rows = list.map(({ projectId, orgId, environment, event }, i) => {
      const e = event as Extract<NormalizedEvent, { type: 'error' }>;
      const r = rec(event);
      const errorName = errorNameOf(event);
      const fingerprint = errorFingerprint(event, errorName);
      
      const req = (e.context?.request as any) || e.context || {};
      const endpoint = str(e.route ?? r.route ?? req.route ?? req.endpoint ?? e.url ?? r.url ?? req.url, 8192);
      const statusCode = httpStatus(e.statusCode ?? r.statusCode ?? req.statusCode ?? req.status_code);
      const statusText = str(
        e.statusText ?? r.statusText ?? req.statusText ?? req.status_text
          ?? (statusCode == null ? null : STATUS_CODES[statusCode]),
        128,
      );
      const handled = bool(e.handled ?? r.handled);
      const durationMs = num(req.duration ?? req.duration_ms ?? req.durationMs);

      const attributes: Record<string, any> = { ...(r.extra as any) };
      if (r.tags) attributes.tags = r.tags;
      if (r.user) attributes.user = r.user;
      
      return [
        orgId, projectId, ids[i], fingerprint, e.message,
        errorName, eventSeverity(e.severity, 'error'),
        e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null,
        str(e.mechanism ?? r.mechanism, 50), str(r.service, 100),
        environment, str(sdkMetadataField(event, environment, 'release'), 100), str(sdkMetadataField(event, environment, 'serverName'), 100),
        str(sdkMetadataField(event, environment, 'applicationName'), 100), str(sdkMetadataField(event, environment, 'applicationVersion'), 50),
        JSON.stringify(e.stack ?? []), JSON.stringify(e.breadcrumbs ?? []), JSON.stringify(e.context ?? {}),
        endpoint ?? null, statusCode ?? null, statusText ?? null, handled, durationMs ?? null, JSON.stringify(attributes),
        str(r.userId ?? (r.user as any)?.id ?? (e.context as any)?.userId, 255),
        str(sdkMetadataField(event, environment, 'sdkName'), 50), str(sdkMetadataField(event, environment, 'sdkVersion'), 50), JSON.stringify(metadataFor(event, environment)), iso(resolveTimestamp(event)),
        payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];
    });
    const { text, values } = buildInsert(
      'events_errors',
      ['organization_id', 'project_id', 'event_id', 'fingerprint', 'message',
       'error_name', 'severity', 'trace_id', 'span_id', 'request_id', 'session_id',
       'mechanism', 'service', 'environment', 'release', 'server_name',
       'application_name', 'application_version',
       'stack_frames', 'breadcrumbs', 'contexts', 
       'endpoint', 'status_code', 'status_text', 'handled', 'duration_ms', 'attributes', 'user_id',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'payload', 'ai_response'],
      rows,
      'event_id',
    );
    const res = await db.query<{ event_id: string }>(text, values);
    // Pair each returned event_id with its first unpaired input occurrence, so
    // a duplicate event_id WITHIN one batch (only the first occurrence inserts)
    // is not double-counted by downstream error grouping.
    const unpaired = new Map<string, number>();
    for (const row of res.rows) unpaired.set(row.event_id, (unpaired.get(row.event_id) ?? 0) + 1);
    const insertedErrors: ScopedEvent[] = [];
    for (let i = 0; i < list.length; i++) {
      const id = ids[i] as string;
      const n = unpaired.get(id) ?? 0;
      if (n > 0) {
        insertedErrors.push(list[i] as ScopedEvent);
        if (n === 1) unpaired.delete(id);
        else unpaired.set(id, n - 1);
      }
    }
    return { inserted: res.rowCount ?? 0, insertedErrors };
  }

  // ── events_messages ─────────────────────────────────────────────────────────
  private async writeMessages(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    const rows = list.map(({ projectId, orgId, environment, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'message' }>;
      const r = rec(event);
      
      const tags = plainObject(r.tags) ?? {};
      const ctx = plainObject(e.context) ?? {};
      const attrs = plainObject(r.attributes) ?? {};
      const loggerName = str(e.loggerName ?? r.loggerName ?? r.logger, 128);
      const sdkName = str(sdkMetadataField(event, environment, 'sdkName'), 50);
      
      const name = str(e.name ?? r.name, 256) ?? str(e.message, 100) ?? 'Untitled';
      const tenantId = str(e.tenantId ?? r.tenantId ?? attrValue(attrs, 'tenantId') ?? (r.extra as any)?.tenantId, 255);
      const messageCategory = classifyMessageCategory(e.message, tags, loggerName, ctx);
      const messageSource = classifyMessageSource(sdkName, loggerName);

      return [
        orgId, projectId, this.eventId(event), e.message, eventSeverity(e.severity, 'info'),
        e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null,
        str(r.service, 100), environment, str(sdkMetadataField(event, environment, 'release'), 100),
        str(sdkMetadataField(event, environment, 'serverName'), 100), str(sdkMetadataField(event, environment, 'applicationName'), 100), str(sdkMetadataField(event, environment, 'applicationVersion'), 50),
        str(r.userId, 255), inet(r.userIp),
        JSON.stringify(tags), JSON.stringify(ctx), JSON.stringify(e.breadcrumbs ?? []),
        sdkName, str(sdkMetadataField(event, environment, 'sdkVersion'), 50), JSON.stringify(metadataFor(event, environment)), iso(resolveTimestamp(event)),
        payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
        tenantId, loggerName, messageCategory, messageSource,
        str(e.endpoint ?? r.endpoint, 8192), num(e.statusCode ?? r.statusCode ?? r.status_code),
        name, JSON.stringify(attrs)
      ];
    });
    const { text, values } = buildInsert(
      'events_messages',
      ['organization_id', 'project_id', 'event_id', 'message', 'severity',
       'trace_id', 'span_id', 'request_id', 'session_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'user_id', 'user_ip',
       'tags', 'contexts', 'breadcrumbs', 'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'payload', 'ai_response',
       'tenant_id', 'logger_name', 'message_category', 'message_source',
       'endpoint', 'status_code', 'name', 'attributes'],
      rows,
    );
    const res = await db.query(text, values);
    return { inserted: res.rowCount ?? 0 };
  }

  // ── events_requests ─────────────────────────────────────────────────────────
  private async writeRequests(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    // Open the GeoIP databases once (no-op after first call; never throws).
    await this.enricher.init();
    const rows = list.map(({ projectId, orgId, environment, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'request' }>;
      const r = rec(event);
      const endpoint = str(r.route, 500) ?? str(e.url, 8192);
      const name = endpoint ? `${e.method} ${endpoint}`.slice(0, 1024) : e.method;
      
      const headers = (e.headers && typeof e.headers === 'object') ? (e.headers as Record<string, unknown>) : {};
      const rawUserAgent = r.userAgent ?? r.user_agent ?? headers['user-agent'] ?? headers['User-Agent'] ?? null;
      const rawClientIp = r.clientIp ?? r.client_ip ?? headers['x-forwarded-for'] ?? headers['x-real-ip'] ?? null;
      
      // Enrich clientIp -> geo, userAgent -> browser/os/device. Populates the
      // 14_observability/015 columns; missing data resolves to null ("Unknown").
      const g = this.enricher.enrich(rawClientIp, rawUserAgent);
      return [
        orgId, projectId, this.eventId(event), e.requestId, endpoint, name, e.method,
        // duration_ms preserves fractional milliseconds.
        e.statusCode, num(e.latency), str(r.framework, 50),
        JSON.stringify(e.headers ?? {}), JSON.stringify(e.query ?? {}),
        e.body != null ? JSON.stringify(e.body) : null,
        num(e.bodySize), num(r.responseSize),
        str(r.userId, 255), str(r.tenantId, 255), e.sessionId ?? null,
        inet(rawClientIp), str(rawUserAgent, 1024), str(r.referer, 1024),
        e.traceId ?? null, e.spanId ?? null,
        str(r.service, 100), environment, str(sdkMetadataField(event, environment, 'release'), 100),
        str(sdkMetadataField(event, environment, 'serverName'), 100), str(sdkMetadataField(event, environment, 'applicationName'), 100), str(sdkMetadataField(event, environment, 'applicationVersion'), 50),
        str(sdkMetadataField(event, environment, 'sdkName'), 50), str(sdkMetadataField(event, environment, 'sdkVersion'), 50), JSON.stringify(requestAttributes(event)), JSON.stringify(metadataFor(event, environment)), iso(resolveTimestamp(event)),
        // Enrichment columns.
        g.geoCountryCode, g.geoRegion, g.geoAsn, g.clientIpHash,
        g.browserFamily, g.browserVersionMajor, g.osName, g.osVersionMajor,
        g.deviceType, g.isBot, payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];
    });
    // is_slow / is_error are GENERATED columns — do NOT insert them.
    const { text, values } = buildInsert(
      'events_requests',
      ['organization_id', 'project_id', 'event_id', 'request_id', 'endpoint', 'name', 'method',
       'status_code', 'duration_ms', 'framework', 'headers', 'query_params',
       'body', 'body_size', 'response_size', 'user_id', 'tenant_id', 'session_id',
       'client_ip', 'user_agent', 'referer', 'trace_id', 'span_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'attributes', 'metadata', 'timestamp',
       'geo_country_code', 'geo_region', 'geo_asn', 'client_ip_hash',
       'browser_family', 'browser_version_major', 'os_name', 'os_version_major',
       'device_type', 'is_bot', 'payload', 'ai_response'],
      rows,
    );
    const res = await db.query(text, values);
    return { inserted: res.rowCount ?? 0 };
  }

  // ── events_spans ─────────────────────────────────────────────────────────
  private async writeSpans(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    const rows = list.map(({ projectId, orgId, environment, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'span' }>;
      const r = rec(event);
      const attrs = plainObject(e.attributes) ?? {};
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
        orgId, projectId, this.eventId(event), e.spanId, e.traceId, e.parentSpanId ?? null,
        kind, spanType, status, e.parentSpanId == null, isHttp, isDb, isCache, isMessaging,
        e.name, e.statusMessage ?? null, endpoint,
        iso(e.startTime), e.endTime != null ? iso(e.endTime) : null,
        num(e.duration), num(e.exclusiveDuration), iso(resolveTimestamp(event)), iso(resolveTimestamp(event)),
        str(attrValue(attrs, 'http.method'), 10), str(attrValue(attrs, 'http.route'), 500),
        str(attrValue(attrs, 'http.url'), 8192), str(attrValue(attrs, 'http.target'), 2048),
        str(attrValue(attrs, 'http.host'), 255), str(attrValue(attrs, 'http.scheme'), 32),
        str(attrValue(attrs, 'http.flavor'), 32), num(attrValue(attrs, 'http.status_code')),
        str(attrValue(attrs, 'http.status_text'), 255), num(attrValue(attrs, 'http.response.body.size')),
        str(attrValue(attrs, 'http.user_agent'), 1024), str(attrValue(attrs, 'http.client_ip'), 255),
        str(attrValue(attrs, 'net.transport'), 64), str(attrValue(attrs, 'net.host.name'), 255),
        str(attrValue(attrs, 'net.host.ip'), 255), num(attrValue(attrs, 'net.host.port')),
        str(attrValue(attrs, 'net.peer.ip'), 255), num(attrValue(attrs, 'net.peer.port')),
        str(attrValue(attrs, 'db.system') ?? r.dbSystem, 50), str(attrValue(attrs, 'db.name') ?? r.dbName, 100),
        str(attrValue(attrs, 'db.operation') ?? r.dbOperation, 50), str(attrValue(attrs, 'db.collection') ?? r.dbCollection, 100),
        str(attrValue(attrs, 'db.statement') ?? attrValue(attrs, 'query') ?? r.dbStatement, 8192),
        str(attrValue(attrs, 'messaging.system') ?? r.messagingSystem, 50),
        str(attrValue(attrs, 'messaging.destination') ?? r.messagingDestination, 255),
        str(attrValue(attrs, 'messaging.operation') ?? r.messagingOperation, 50),
        JSON.stringify(normalizedSpanAttributes(attrs)), JSON.stringify(e.events ?? []), JSON.stringify(e.links ?? []),
        requestId, e.sessionId ?? null, str(r.userId, 255), tenantId,
        str(r.service, 100), environment, str(sdkMetadataField(event, environment, 'release'), 100),
        str(sdkMetadataField(event, environment, 'serverName'), 100), str(sdkMetadataField(event, environment, 'applicationName'), 100), str(sdkMetadataField(event, environment, 'applicationVersion'), 50),
        str(sdkMetadataField(event, environment, 'sdkName'), 50), str(sdkMetadataField(event, environment, 'sdkVersion'), 50), JSON.stringify(metadataFor(event, environment)),
        payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];
    });
    const { text, values } = buildInsert(
      'events_spans',
      ['organization_id', 'project_id', 'event_id', 'span_id', 'trace_id', 'parent_span_id',
       'span_kind', 'span_type', 'span_status', 'is_root_span', 'is_http_span', 'is_db_span', 'is_cache_span', 'is_messaging_span',
       'name', 'message', 'endpoint', 'start_time', 'end_time',
       'duration_ms', 'exclusive_duration_ms', 'occurred_at', 'timestamp',
       'http_method', 'http_route', 'http_url', 'http_target', 'http_host', 'http_scheme', 'http_flavor',
       'http_status_code', 'http_status_text', 'http_response_size', 'http_user_agent', 'client_ip_hash',
       'net_transport', 'net_host_name', 'net_host_ip', 'net_host_port', 'net_peer_ip', 'net_peer_port',
       'db_system', 'db_name', 'db_operation', 'db_collection', 'db_statement',
       'messaging_system', 'messaging_destination', 'messaging_operation',
       'attributes', 'events', 'links',
       'request_id', 'session_id', 'user_id', 'tenant_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'payload', 'ai_response'],
      rows,
    );
    const res = await db.query(text, values);
    return { inserted: res.rowCount ?? 0 };
  }

  // ── events_traces ─────────────────────────────────────────────────────────
  private async writeTraces(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    return this.writeTracesInTransaction(list, db);
  }

  private async writeTracesInTransaction(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    const rows = list.map(({ projectId, orgId, environment, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'trace' }>;
      const r = rec(event);
      const root = plainObject(e.rootSpan) ?? {};
      const rootAttrs = plainObject(root.attributes);
      const endpoint = str(attrValue(rootAttrs, 'http.route'), 500) ?? str(attrValue(rootAttrs, 'route'), 500);
      const httpMethod = str(attrValue(rootAttrs, 'http.method'), 10);
      const statusCode = num(attrValue(rootAttrs, 'http.status_code'));
      const responseSize = num(attrValue(rootAttrs, 'http.response.body.size'));
      const rootSpanId = str(root.spanId ?? root.id, 64);
      return [
        orgId, projectId, this.eventId(event), e.traceId, rootSpanId,
        str(root.name, 500), rootSpanId, str(root.kind, 32), spanStatus(root.status), endpoint, httpMethod, statusCode,
        num(root.duration), num(e.totalDuration), responseSize, e.spanCount, e.isPartial ?? false,
        e.rootSpan != null ? JSON.stringify(e.rootSpan) : null,
        e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255), str(r.tenantId, 255),
        str(r.service, 100), environment, str(sdkMetadataField(event, environment, 'release'), 100),
        str(sdkMetadataField(event, environment, 'serverName'), 100), str(sdkMetadataField(event, environment, 'applicationName'), 100), str(sdkMetadataField(event, environment, 'applicationVersion'), 50),
        str(sdkMetadataField(event, environment, 'sdkName'), 50), str(sdkMetadataField(event, environment, 'sdkVersion'), 50), JSON.stringify(traceAttributes(event)), JSON.stringify(metadataFor(event, environment)), iso(resolveTimestamp(event)),
        payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];
    });
    const { text, values } = buildInsert(
      'events_traces',
      ['organization_id', 'project_id', 'event_id', 'trace_id', 'span_id',
       'root_span_name', 'root_span_id', 'span_kind', 'root_span_status', 'endpoint', 'http_method', 'status_code',
       'duration_ms', 'total_duration_ms', 'response_size', 'span_count', 'is_partial',
       'spans_tree', 'request_id', 'session_id', 'user_id', 'tenant_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'attributes', 'metadata', 'timestamp', 'payload', 'ai_response'],
      rows,
    );
    const res = await db.query(text, values);
    await this.writeTraceSpanTree(list, db);
    return { inserted: res.rowCount ?? 0 };
  }

  // ── events_metrics ─────────────────────────────────────────────────────────
  private async writeTraceSpanTree(list: ScopedEvent[], db: Queryable): Promise<void> {
    const rows: unknown[][] = [];
    for (const scoped of list) {
      const e = scoped.event as Extract<NormalizedEvent, { type: 'trace' }>;
      const ts = iso(resolveTimestamp(scoped.event));
      this.collectTraceSpanRows(scoped, e.rootSpan, null, 0, ts, rows);
    }
    if (rows.length === 0) return;
    const { text, values } = buildInsert(
      'events_spans',
      ['organization_id', 'project_id', 'event_id', 'span_id', 'trace_id', 'parent_span_id',
       'name', 'kind', 'span_kind', 'span_type', 'status', 'span_status', 'status_message', 'message', 'endpoint',
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
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'payload'],
      rows,
    );
    await db.query(text, values);
  }

  private collectTraceSpanRows(
    scoped: ScopedEvent,
    span: unknown,
    parentSpanId: string | null,
    depth: number,
    timestamp: string,
    rows: unknown[][],
  ): void {
    const s = plainObject(span);
    if (!s) return;
    const event = scoped.event as Extract<NormalizedEvent, { type: 'trace' }>;
    const spanId = str(s.spanId ?? s.id, 64);
    if (!spanId) return;
    const attrs = plainObject(s.attributes) ?? {};
    const eventId = `${this.eventId(event)}:${spanId}`.slice(0, 64);
    const kind = spanKind(s.kind);
    const status = spanStatus(s.status);
    const name = str(s.name, 500) ?? spanId;
    const endpoint = str(attrValue(attrs, 'http.route') ?? attrValue(attrs, 'route'), 500);
    const spanType = classifySpan(kind, name, attrs);
    const isHttp = spanType === 'http';
    const isDb = spanType === 'database';
    const isCache = spanType === 'cache';
    const isMessaging = ['messaging', 'queue', 'producer', 'consumer'].includes(spanType);
    rows.push([
      scoped.orgId, scoped.projectId, eventId, spanId, event.traceId, parentSpanId,
      name, kind, kind, spanType, status, status, str(s.statusMessage, 1024), str(s.statusMessage, 1024), endpoint,
      parentSpanId == null, isHttp, isDb, isCache, isMessaging,
      s.startTime != null ? iso(Number(s.startTime)) : null,
      s.endTime != null ? iso(Number(s.endTime)) : null,
      num(s.duration), num(s.exclusiveDuration), timestamp, JSON.stringify(normalizedSpanAttributes(attrs)),
      s.events != null ? JSON.stringify(s.events) : JSON.stringify([]),
      s.links != null ? JSON.stringify(s.links) : JSON.stringify([]),
      depth,
      str(attrValue(attrs, 'http.method'), 10), str(attrValue(attrs, 'http.route'), 500),
      str(attrValue(attrs, 'http.url'), 8192), str(attrValue(attrs, 'http.target'), 2048),
      str(attrValue(attrs, 'http.host'), 255), str(attrValue(attrs, 'http.scheme'), 32), str(attrValue(attrs, 'http.flavor'), 32),
      num(attrValue(attrs, 'http.status_code')), str(attrValue(attrs, 'http.status_text'), 255),
      num(attrValue(attrs, 'http.response.body.size')), str(attrValue(attrs, 'http.user_agent'), 1024), str(attrValue(attrs, 'http.client_ip'), 255),
      str(attrValue(attrs, 'net.transport'), 64), str(attrValue(attrs, 'net.host.name'), 255), str(attrValue(attrs, 'net.host.ip'), 255),
      num(attrValue(attrs, 'net.host.port')), str(attrValue(attrs, 'net.peer.ip'), 255), num(attrValue(attrs, 'net.peer.port')),
      str(attrValue(attrs, 'db.system'), 50), str(attrValue(attrs, 'db.name'), 100), str(attrValue(attrs, 'db.operation'), 50),
      str(attrValue(attrs, 'db.collection'), 100), str(attrValue(attrs, 'db.statement') ?? attrValue(attrs, 'query'), 8192),
      str(attrValue(attrs, 'messaging.system'), 50), str(attrValue(attrs, 'messaging.destination'), 255), str(attrValue(attrs, 'messaging.operation'), 50),
      event.requestId ?? str(attrValue(attrs, 'pulse.request_id'), 255), event.sessionId ?? null, str(rec(event).userId, 255),
      str(rec(event).tenantId, 255) ?? str(attrValue(attrs, 'pulse.tenant_id'), 255),
      str(rec(event).service, 100), scoped.environment, str(sdkMetadataField(event, scoped.environment, 'release'), 100),
      str(sdkMetadataField(event, scoped.environment, 'serverName'), 100), str(sdkMetadataField(event, scoped.environment, 'applicationName'), 100), str(sdkMetadataField(event, scoped.environment, 'applicationVersion'), 50),
      str(sdkMetadataField(event, scoped.environment, 'sdkName'), 50), str(sdkMetadataField(event, scoped.environment, 'sdkVersion'), 50),
      JSON.stringify(metadataFor(event, scoped.environment)), timestamp, payloadFor(event),
    ]);
    const children = Array.isArray(s.children) ? s.children : [];
    for (const child of children) this.collectTraceSpanRows(scoped, child, spanId, depth + 1, timestamp, rows);
  }

  private async writeMetrics(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    const rows = list.map(({ projectId, orgId, environment, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'metric' }>;
      const r = rec(event);
      const tags = plainObject(e.tags) ?? {};
      // Resolve metric_unit from canonical SDK field first, then legacy 'unit'
      const metricUnit = str(e.metricUnit ?? e.unit ?? r.metricUnit ?? r.unit, 50);
      // Promote HTTP context out of tags (no JSON parsing at query time)
      const endpoint   = str(tagValue(tags, 'path', 'route', 'endpoint', 'http.route'), 500);
      const httpMethod = str(tagValue(tags, 'method', 'http.method', 'http_method'), 10);
      const statusCode = num(tagValue(tags, 'status', 'statusCode', 'status_code', 'http.status_code'));
      // Automatic classification — no JSON at dashboard query time
      const metricCategory = str(r.metricCategory, 50) ?? classifyMetric(e.metricName, e.metricType, tags);
      const aggType        = str(r.aggregationType, 50) ?? aggregationType(e.metricType);
      // Percentiles: prefer SDK-supplied values, resolved from both camelCase and snake_case
      const p50 = num(e.p50 ?? r.p50);
      const p75 = num(e.p75 ?? r.p75);
      const p90 = num(e.p90 ?? r.p90);
      const p95 = num(e.p95 ?? r.p95);
      const p99 = num(e.p99 ?? r.p99);
      return [
        // identity
        orgId, projectId, this.eventId(event),
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
        str(sdkMetadataField(event, environment, 'release'), 100),
        str(sdkMetadataField(event, environment, 'serverName'), 100),
        str(sdkMetadataField(event, environment, 'applicationName'), 100),
        str(sdkMetadataField(event, environment, 'applicationVersion'), 50),
        str(sdkMetadataField(event, environment, 'sdkName'), 50),
        str(sdkMetadataField(event, environment, 'sdkVersion'), 50),
        // raw tags (full JSONB), clean attributes (custom-only), debug copies
        JSON.stringify(e.tags ?? {}),
        JSON.stringify(metricAttributes(event)),
        JSON.stringify(metadataFor(event, environment)),
        iso(resolveTimestamp(event)),
        payloadFor(event),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];
    });
    const { text, values } = buildInsert(
      'events_metrics',
      [// identity
       'organization_id', 'project_id', 'event_id',
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
       'tags', 'attributes', 'metadata', 'timestamp', 'payload', 'ai_response'],
      rows,
    );
    const res = await db.query(text, values);
    return { inserted: res.rowCount ?? 0 };
  }

  // ── events_logs ─────────────────────────────────────────────────────────
  private async writeLogs(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    const rows = list.map(({ projectId, orgId, environment, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'log' }>;
      const r = rec(event);

      const msg = e.message ?? '';
      const c = plainObject(e.context) ?? {};
      const httpC = plainObject(c.http) ?? {};

      // ── Extraction logic ──────────────────────────────────────────────────────
      const httpMethod = e.httpMethod ?? str(httpC.method, 16) ?? (msg.match(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+/)?.[1]) ?? null;
      const endpoint = e.endpoint ?? str(httpC.url, 2048) ?? (msg.match(/^(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+([^?\s]+)/)?.[1]) ?? null;
      let statusCode = e.statusCode ?? num(httpC.status_code);
      if (statusCode == null) {
        const sc1 = msg.match(/HTTP.*?\s([2-5][0-9]{2})\b/)?.[1];
        if (sc1) statusCode = Number(sc1);
        else {
          const sc2 = msg.match(/\b([2-5][0-9]{2})\b.*?\s\d+ms/)?.[1];
          if (sc2) statusCode = Number(sc2);
        }
      }
      let durationMs = e.durationMs ?? num(httpC.duration_ms);
      if (durationMs == null) {
        const d = msg.match(/\b(\d+)\s*ms\b/)?.[1];
        if (d) durationMs = Number(d);
      }

      // ── Categorization ────────────────────────────────────────────────────────
      const loggerName = str(e.loggerName ?? r.loggerName ?? e.logger, 255) ?? 'unknown';
      const loggerLower = loggerName.toLowerCase();
      const msgLower = msg.toLowerCase();

      const name = str(e.name, 255) ?? (
        msg.match(/^(GET|POST|PUT|DELETE|PATCH)\s+/) ? 'HTTP Request' :
        (msgLower.includes('error') || e.level === 'error' || e.level === 'fatal') ? 'Error Log' :
        (loggerLower.includes('db') || loggerLower.includes('postgres')) ? 'Database Query' :
        (loggerLower.includes('cache') || loggerLower.includes('redis')) ? 'Cache Operation' :
        (loggerLower.includes('worker') || loggerLower.includes('job') || loggerLower.includes('queue')) ? 'Background Job' :
        'Log Event'
      );

      const logSource = e.logSource ?? (
        e.sdkName != null ? 'sdk' :
        (loggerLower.includes('express') || loggerLower.includes('koa') || loggerLower.includes('fastify')) ? 'framework' :
        loggerLower.includes('middleware') ? 'middleware' :
        (loggerLower.includes('worker') || loggerLower.includes('job')) ? 'worker' :
        'unknown'
      );

      const logCategory = e.logCategory ?? (
        (msgLower.includes('get ') || msgLower.includes('post ') || loggerLower.includes('http')) ? 'http' :
        (loggerLower.includes('db') || loggerLower.includes('sql') || loggerLower.includes('postgres')) ? 'database' :
        (loggerLower.includes('redis') || loggerLower.includes('cache')) ? 'cache' :
        (loggerLower.includes('auth') || msgLower.includes('login') || msgLower.includes('unauthorized')) ? 'authentication' :
        (loggerLower.includes('queue') || loggerLower.includes('worker')) ? 'worker' :
        (e.level === 'error' || e.level === 'fatal' || msgLower.includes('exception')) ? 'application' :
        'application'
      );

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
      const cleanAttributes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawAttrs)) {
        if (!LOG_ATTR_DUPES.has(k)) cleanAttributes[k] = v;
      }
      const extra = plainObject(r.extra);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          if (!LOG_ATTR_DUPES.has(k)) cleanAttributes[k] = v;
        }
      }

      return [
        orgId, projectId, this.eventId(event), logLevel(e.level), msg,
        JSON.stringify(e.args ?? []), e.traceId ?? null, e.spanId ?? null,
        str(e.parentSpanId ?? r.parentSpanId, 128), str(e.tenantId ?? r.tenantId, 255),
        name, loggerName, logSource, logCategory, endpoint, httpMethod, statusCode, durationMs,
        e.requestId ?? null, e.sessionId ?? null,
        str(r.service, 100), environment, str(sdkMetadataField(event, environment, 'release'), 100),
        str(sdkMetadataField(event, environment, 'serverName'), 100), str(sdkMetadataField(event, environment, 'applicationName'), 100), str(sdkMetadataField(event, environment, 'applicationVersion'), 50),
        str(r.userId, 255), inet(r.userIp),
        str(sdkMetadataField(event, environment, 'sdkName'), 50), str(sdkMetadataField(event, environment, 'sdkVersion'), 50),
        JSON.stringify(c), JSON.stringify(e.tags ?? {}), JSON.stringify(cleanAttributes),
        JSON.stringify(metadataFor(event, environment)), iso(resolveTimestamp(event)),
        payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];
    });
    const { text, values } = buildInsert(
      'events_logs',
      ['organization_id', 'project_id', 'event_id', 'level', 'message',
       'args', 'trace_id', 'span_id', 'parent_span_id', 'tenant_id',
       'name', 'logger_name', 'log_source', 'log_category', 'endpoint', 'http_method', 'status_code', 'duration_ms',
       'request_id', 'session_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'user_id', 'user_ip',
       'sdk_name', 'sdk_version', 'context', 'tags', 'attributes',
       'metadata', 'timestamp', 'payload', 'ai_response'],
      rows,
    );
    const res = await db.query(text, values);
    return { inserted: res.rowCount ?? 0 };
  }

  // ── events_profiles ─────────────────────────────────────────────────────────
  private async writeProfiles(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    const rows = list.map(({ projectId, orgId, environment, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'profile' }>;
      const r = rec(event);
      const ts = resolveTimestamp(event);
      return [
        orgId, projectId, this.eventId(event), str(e.profileType, 20) ?? 'cpu',
        e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255),
        e.startTime != null ? iso(e.startTime) : iso(ts),
        e.endTime != null ? iso(e.endTime) : null, num(e.duration),
        e.profile != null ? JSON.stringify(e.profile) : null,
        str(r.service, 100), environment, str(sdkMetadataField(event, environment, 'release'), 100),
        str(sdkMetadataField(event, environment, 'serverName'), 100), str(sdkMetadataField(event, environment, 'applicationName'), 100), str(sdkMetadataField(event, environment, 'applicationVersion'), 50),
        str(sdkMetadataField(event, environment, 'sdkName'), 50), str(sdkMetadataField(event, environment, 'sdkVersion'), 50), JSON.stringify(metadataFor(event, environment)), iso(ts),
        payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];
    });
    const { text, values } = buildInsert(
      'events_profiles',
      ['organization_id', 'project_id', 'event_id', 'profile_type',
       'trace_id', 'span_id', 'request_id', 'session_id', 'user_id', 'start_time', 'end_time', 'duration_ms',
       'profile_data', 'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'payload', 'ai_response'],
      rows,
    );
    const res = await db.query(text, values);
    return { inserted: res.rowCount ?? 0 };
  }

  // ── events_cron_checkins ─────────────────────────────────────────────────────
  private async writeCronCheckins(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    const rows = list.map(({ projectId, orgId, environment, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'cron_checkin' }>;
      const r = rec(event);

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
      const cleanAttributes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawAttrs)) {
        if (!CRON_ATTR_DUPES.has(k)) cleanAttributes[k] = v;
      }
      // Merge extra object into attributes (custom business data)
      const extra = plainObject(r.extra);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          if (!CRON_ATTR_DUPES.has(k)) cleanAttributes[k] = v;
        }
      }

      return [
        // identity
        orgId, projectId, this.eventId(event),
        // monitor
        e.monitorSlug, str(e.monitorName ?? r.monitorName, 255),
        // status + derived
        e.status, isSuccess,
        // timing
        num(e.duration),
        e.startedAt != null ? iso(Number(e.startedAt)) : null,
        e.finishedAt != null ? iso(Number(e.finishedAt)) : null,
        // classification
        checkinType, str(e.scheduleType ?? r.scheduleType, 64),
        // correlation IDs
        e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null,
        str(r.userId, 255), str(e.tenantId ?? r.tenantId, 255),
        // SDK origin
        str(r.service, 100), environment,
        str(sdkMetadataField(event, environment, 'release'), 100),
        str(sdkMetadataField(event, environment, 'serverName'), 100),
        str(sdkMetadataField(event, environment, 'applicationName'), 100),
        str(sdkMetadataField(event, environment, 'applicationVersion'), 50),
        str(sdkMetadataField(event, environment, 'sdkName'), 50),
        str(sdkMetadataField(event, environment, 'sdkVersion'), 50),
        // JSONB
        JSON.stringify(e.tags ?? {}),
        JSON.stringify(cleanAttributes),
        JSON.stringify(metadataFor(event, environment)),
        iso(resolveTimestamp(event)),
        payloadFor(event),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];
    });
    const { text, values } = buildInsert(
      'events_cron_checkins',
      [// identity
       'organization_id', 'project_id', 'event_id',
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
       'tags', 'attributes', 'metadata', 'timestamp', 'payload', 'ai_response'],
      rows,
    );
    const res = await db.query(text, values);
    return { inserted: res.rowCount ?? 0 };
  }

  // ── events_replays ─────────────────────────────────────────────────────────
  private async writeReplays(list: ScopedEvent[], db: Queryable): Promise<TypedWriteResult> {
    const rows = list.map(({ projectId, orgId, environment, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'replay' }>;
      const r = rec(event);
      return [
        orgId, projectId, this.eventId(event), e.sessionId, e.segmentId,
        JSON.stringify(e.events ?? []),
        e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, str(r.userId, 255),
        str(r.service, 100), environment, str(sdkMetadataField(event, environment, 'release'), 100),
        str(sdkMetadataField(event, environment, 'serverName'), 100), str(sdkMetadataField(event, environment, 'applicationName'), 100), str(sdkMetadataField(event, environment, 'applicationVersion'), 50),
        str(sdkMetadataField(event, environment, 'sdkName'), 50), str(sdkMetadataField(event, environment, 'sdkVersion'), 50), JSON.stringify(metadataFor(event, environment)), iso(resolveTimestamp(event)),
        payloadFor(event), e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];
    });
    const { text, values } = buildInsert(
      'events_replays',
      ['organization_id', 'project_id', 'event_id', 'session_id', 'segment_id',
       'events', 'trace_id', 'span_id', 'request_id', 'user_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'payload', 'ai_response'],
      rows,
    );
    const res = await db.query(text, values);
    return { inserted: res.rowCount ?? 0 };
  }
}

function outboxSeverity(event: NormalizedEvent): string | null {
  if (event.type === 'error') return eventSeverity((event as { severity?: unknown }).severity, 'error');
  if (event.type === 'message') return eventSeverity((event as { severity?: unknown }).severity, 'info');
  if (event.type === 'log') return logLevel((event as { level?: unknown }).level) === 'error' ? 'error' : 'info';
  return null;
}

function isFastPathSignal(scoped: ScopedEvent): boolean {
  const event = scoped.event;
  const record = rec(event);
  if (event.type === 'error') return true;
  if (event.type === 'cron_checkin') return record.status === 'error';
  if (event.type === 'log') {
    const message = typeof record.message === 'string' ? record.message : '';
    return /out of memory|heap out of memory|oom|security|csrf|xss|sql injection|auth bypass/i.test(message);
  }
  if (event.type === 'request') {
    const status = Number(record.statusCode);
    return status === 401 || status === 403;
  }
  return false;
}
