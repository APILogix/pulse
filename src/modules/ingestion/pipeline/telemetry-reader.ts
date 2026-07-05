/**
 * TelemetryReader — reads persisted telemetry from the AUTHORITATIVE analytics
 * event schema (migrations2/004 `events_*` tables).
 *
 * Repointed from the legacy `migrations/013-014` tables (`errors`, `requests`,
 * …) to the `events_*` tables that the TelemetryWriter now writes and that the
 * analytics module reads. Scoping is by `project_id` (every events_* row also
 * carries `organization_id`). Resolution state for errors lives at the GROUP
 * level (`analytics_error_groups.status`), not per-event, so the per-event
 * `resolved_*` fields are reported as null here.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type {
  EnrichedEvent,
  ErrorEventListResult,
  ErrorEventRecord,
  NormalizedErrorEventListQuery,
  SDKErrorEvent,
} from '../types.js';
import type { NormalizedEvent, SdkEventType } from './event-normalizer.js';

interface ErrorRow {
  id: string;
  organization_id: string | null;
  project_id: string | null;
  event_id: string | null;
  request_id: string | null;
  message: string;
  error_name: string;
  fingerprint: string;
  stack_frames: unknown;
  contexts: unknown;
  breadcrumbs: unknown;
  severity: string | null;
  timestamp: Date | string;
  created_at: Date | string;
}

// SDK type -> authoritative events_* table.
const REPLAY_TYPE_TABLES: Array<{ type: SdkEventType; table: string }> = [
  { type: 'error', table: 'events_errors' },
  { type: 'request', table: 'events_requests' },
  { type: 'span', table: 'events_spans' },
  { type: 'trace', table: 'events_traces' },
  { type: 'metric', table: 'events_metrics' },
  { type: 'log', table: 'events_logs' },
  { type: 'message', table: 'events_messages' },
  { type: 'profile', table: 'events_profiles' },
  { type: 'cron_checkin', table: 'events_cron_checkins' },
  { type: 'replay', table: 'events_replays' },
];

export class TelemetryReader {
  constructor(private readonly pool: Pool) {}

  async listErrorEvents(query: NormalizedErrorEventListQuery): Promise<ErrorEventListResult> {
    const params: unknown[] = [query.projectId];
    const where = ['e.project_id = $1'];
    let index = params.length;

    if (query.from) {
      params.push(query.from);
      where.push(`e.timestamp >= $${++index}`);
    }
    if (query.to) {
      params.push(query.to);
      where.push(`e.timestamp <= $${++index}`);
    }
    if (query.fingerprint) {
      params.push(query.fingerprint);
      where.push(`e.fingerprint = $${++index}`);
    }
    if (query.errorType) {
      params.push(query.errorType);
      where.push(`e.error_name = $${++index}`);
    }
    // NOTE: per-event resolution does not exist in events_errors; resolution is
    // tracked at the group level (analytics_error_groups.status). The `resolved`
    // filter is therefore intentionally ignored here.

    const whereSql = where.join(' AND ');
    const countParams = [...params];

    params.push(query.limit, query.offset);
    const limitParam = ++index;
    const offsetParam = ++index;

    const list = await this.pool.query<ErrorRow>(
      `
        SELECT e.id, e.organization_id, e.project_id, e.event_id, e.request_id,
               e.message, e.error_name, e.fingerprint, e.stack_frames, e.contexts,
               e.breadcrumbs, e.severity, e.timestamp, e.created_at
        FROM events_errors e
        WHERE ${whereSql}
        ORDER BY e.timestamp DESC, e.id DESC
        LIMIT $${limitParam}
        OFFSET $${offsetParam}
      `,
      params,
    );

    const count = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::int AS total FROM events_errors e WHERE ${whereSql}`,
      countParams,
    );

    const total = Number(count.rows[0]?.total ?? 0);

    return {
      data: list.rows.map((row) => this.mapErrorRow(row)),
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + list.rows.length < total,
    };
  }

  async getErrorEventById(errorId: string, projectId: string): Promise<ErrorEventRecord | null> {
    const result = await this.pool.query<ErrorRow>(
      `
        SELECT e.id, e.organization_id, e.project_id, e.event_id, e.request_id,
               e.message, e.error_name, e.fingerprint, e.stack_frames, e.contexts,
               e.breadcrumbs, e.severity, e.timestamp, e.created_at
        FROM events_errors e
        WHERE e.project_id = $1 AND e.id = $2
        LIMIT 1
      `,
      [projectId, errorId],
    );
    const row = result.rows[0];
    return row ? this.mapErrorRow(row) : null;
  }

  async getEventById(eventId: string, projectId: string): Promise<Record<string, unknown> | null> {
    for (const { type, table } of REPLAY_TYPE_TABLES) {
      const result = await this.pool.query(
        `SELECT e.id, e.organization_id, e.project_id, e.event_id,
                e.timestamp, e.created_at, to_jsonb(e) AS details
         FROM ${table} e
         WHERE e.id = $1 AND e.project_id = $2
         LIMIT 1`,
        [eventId, projectId],
      );
      if (result.rows.length > 0) {
        const details = result.rows[0].details as Record<string, unknown>;
        return { type, ...details, details };
      }
    }
    return null;
  }

  async getEventsForReplay(
    projectId: string,
    startTime: string,
    endTime: string,
    eventTypes?: string[],
    maxEvents = 10_000,
  ): Promise<EnrichedEvent[]> {
    const safeMax =
      Number.isFinite(maxEvents) && maxEvents > 0
        ? Math.min(Math.trunc(maxEvents), 100_000)
        : 10_000;

    const allowed = new Set(
      (eventTypes?.length ? eventTypes : REPLAY_TYPE_TABLES.map((t) => t.type)) as SdkEventType[],
    );

    const collected: EnrichedEvent[] = [];

    for (const { type, table } of REPLAY_TYPE_TABLES) {
      if (!allowed.has(type)) continue;
      if (collected.length >= safeMax) break;

      const remaining = safeMax - collected.length;
      const rows = await this.pool.query(
        `SELECT e.id, e.organization_id, e.project_id, e.event_id,
                e.timestamp, e.created_at, to_jsonb(e) AS details
         FROM ${table} e
         WHERE e.project_id = $1 AND e.timestamp BETWEEN $2 AND $3
         ORDER BY e.timestamp ASC
         LIMIT $4`,
        [projectId, startTime, endTime, remaining],
      );

      for (const row of rows.rows) {
        const details = row.details as Record<string, unknown>;
        const normalized = this.rowToNormalizedEvent(type, details);
        if (!normalized) continue;
        const item: EnrichedEvent = {
          id: String(details.id),
          type,
          projectId,
          orgId: details.organization_id ? String(details.organization_id) : '',
          receivedAt: Date.now(),
          batchId: `replay-${Date.now()}`,
          payload: normalized as EnrichedEvent['payload'],
        };
        if (details.request_id) item.requestId = String(details.request_id);
        if (details.created_at) {
          item.ingestedAt = new Date(details.created_at as string).toISOString();
        }
        collected.push(item);
      }
    }

    collected.sort(
      (a, b) =>
        new Date(a.payload.timestamp ?? 0).getTime() -
        new Date(b.payload.timestamp ?? 0).getTime(),
    );

    return collected.slice(0, safeMax);
  }

  private mapErrorRow(row: ErrorRow): ErrorEventRecord {
    const timestampMs = new Date(row.timestamp).getTime();
    const payload: SDKErrorEvent = {
      type: 'error',
      requestId: row.request_id ?? randomUUID(),
      message: row.message,
      name: row.error_name,
      stack: Array.isArray(row.stack_frames) ? (row.stack_frames as string[]) : [],
      fingerprint: row.fingerprint,
      timestamp: timestampMs,
      context: (row.contexts as Record<string, unknown>) ?? {},
    };

    return {
      id: row.id,
      eventId: row.event_id ?? row.id,
      projectId: row.project_id ?? '',
      requestId: row.request_id,
      message: row.message,
      errorType: row.error_name,
      fingerprint: row.fingerprint,
      stack: row.stack_frames,
      context: row.contexts,
      metadata: { severity: row.severity, breadcrumbs: row.breadcrumbs },
      timestamp: new Date(row.timestamp).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
      // events_errors has no per-event resolution; tracked in analytics_error_groups.
      resolvedAt: null,
      resolvedBy: null,
      ingestedAt: new Date(row.created_at).toISOString(),
      payload,
    };
  }

  private rowToNormalizedEvent(
    type: SdkEventType,
    row: Record<string, unknown>,
  ): NormalizedEvent | null {
    const ts = new Date(row.timestamp as string).getTime();

    switch (type) {
      case 'error':
        return {
          type: 'error',
          message: String(row.message ?? ''),
          name: String(row.error_name ?? 'UnknownError'),
          fingerprint: String(row.fingerprint ?? ''),
          stack: row.stack_frames,
          context: row.contexts,
          requestId: row.request_id ? String(row.request_id) : undefined,
          timestamp: ts,
        } as NormalizedEvent;
      case 'request':
        return {
          type: 'request',
          requestId: String(row.request_id ?? row.id),
          url: String(row.url ?? ''),
          method: String(row.method ?? 'GET'),
          statusCode: Number(row.status_code ?? 0),
          latency: Number(row.latency_ms ?? 0),
          headers: row.headers,
          query: row.query_params,
          bodySize: row.body_size != null ? Number(row.body_size) : undefined,
          userId: row.user_id ? String(row.user_id) : null,
          timestamp: ts,
        } as NormalizedEvent;
      case 'metric':
        return {
          type: 'metric',
          metricName: String(row.metric_name ?? ''),
          metricType: (row.metric_type as 'counter' | 'gauge' | 'histogram') ?? 'gauge',
          value: row.value != null ? Number(row.value) : undefined,
          unit: row.unit ? String(row.unit) : undefined,
          tags: row.tags as Record<string, string> | undefined,
          timestamp: ts,
        } as NormalizedEvent;
      case 'log':
        return {
          type: 'log',
          level: String(row.level ?? 'info'),
          message: String(row.message ?? ''),
          requestId: row.request_id ? String(row.request_id) : undefined,
          timestamp: ts,
        } as NormalizedEvent;
      default:
        return { type, timestamp: ts, ...row } as NormalizedEvent;
    }
  }
}
