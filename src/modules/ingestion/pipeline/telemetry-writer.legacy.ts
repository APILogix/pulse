/**
 * ============================================================================
 * LEGACY — DISABLED. RETAINED FOR REFERENCE ONLY. DO NOT WIRE.
 * ----------------------------------------------------------------------------
 * This is the PREVIOUS TelemetryWriter implementation that persisted normalized
 * events into the legacy `migrations/013-014` telemetry tables
 * (`errors`, `requests`, `metrics`, `spans`, `traces`, `logs`, `profiles`,
 * `cron_checkins`, `replays`, `messages`).
 *
 * It has been SUPERSEDED by the new TelemetryWriter (telemetry-writer.ts),
 * which writes into the authoritative migrations2/004 `events_*` schema that
 * the analytics + event-analytics modules actually read from. Those legacy
 * tables are outdated and no longer queried, so ingesting into them produced
 * data that never reached analytics/alerting.
 *
 * Nothing imports this file. It is kept (instead of deleted) so the prior
 * column mappings remain available during the migration window.
 * ============================================================================
 */
import type { Pool } from 'pg';
import type { NormalizedEvent } from './event-normalizer.js';
import { resolveTimestamp } from './event-normalizer.js';

/** An event paired with the tenant context resolved from its API key. */
export interface LegacyScopedEvent {
  projectId: string;
  orgId: string | null;
  event: NormalizedEvent;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function buildInsert(table: string, cols: string[], rows: unknown[][]): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const tuples: string[] = [];
  let p = 1;
  for (const row of rows) {
    tuples.push(`(${row.map(() => `$${p++}`).join(', ')})`);
    values.push(...row);
  }
  return {
    text: `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`,
    values,
  };
}

export class LegacyTelemetryWriter {
  constructor(private readonly pool: Pool) {}

  async writeBatch(scoped: LegacyScopedEvent[]): Promise<number> {
    if (scoped.length === 0) return 0;
    const byType = new Map<string, LegacyScopedEvent[]>();
    for (const s of scoped) {
      const list = byType.get(s.event.type) ?? [];
      list.push(s);
      byType.set(s.event.type, list);
    }
    let total = 0;
    for (const [type, list] of byType) {
      total += await this.writeTyped(type, list);
    }
    return total;
  }

  private async writeTyped(type: string, list: LegacyScopedEvent[]): Promise<number> {
    switch (type) {
      case 'span': return this.writeSpans(list);
      case 'metric': return this.writeMetrics(list);
      case 'log': return this.writeLogs(list);
      case 'cron_checkin': return this.writeCronCheckins(list);
      case 'replay': return this.writeReplays(list);
      case 'message': return this.writeMessages(list);
      default: return 0;
    }
  }

  private async writeSpans(list: LegacyScopedEvent[]): Promise<number> {
    const rows = list.map(({ projectId, orgId, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'span' }>;
      const ts = e.startTime ?? resolveTimestamp(event);
      return [
        projectId, orgId, e.traceId, e.spanId, e.parentSpanId ?? null,
        e.name, e.kind ?? null, e.status ?? null, e.statusMessage ?? null,
        iso(e.startTime), e.endTime != null ? iso(e.endTime) : null,
        e.duration ?? null, e.exclusiveDuration ?? null,
        JSON.stringify(e.attributes ?? {}), JSON.stringify(e.events ?? []), JSON.stringify(e.links ?? []),
        e.requestId ?? null, e.sessionId ?? null, null, iso(ts),
      ];
    });
    const { text, values } = buildInsert(
      'spans',
      ['project_id', 'org_id', 'trace_id', 'span_id', 'parent_span_id', 'name', 'kind',
       'status', 'status_message', 'start_time', 'end_time', 'duration_ms', 'exclusive_duration_ms',
       'attributes', 'events', 'links', 'request_id', 'session_id', 'user_id', 'timestamp'],
      rows,
    );
    const r = await this.pool.query(text, values);
    return r.rowCount ?? 0;
  }

  private async writeMetrics(list: LegacyScopedEvent[]): Promise<number> {
    const rows = list.map(({ projectId, orgId, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'metric' }>;
      return [
        projectId, orgId, e.metricName, e.metricType, e.value ?? null, e.unit ?? null,
        e.count ?? null, e.sum ?? null, e.min ?? null, e.max ?? null, e.avg ?? null,
        e.buckets != null ? JSON.stringify(e.buckets) : null,
        JSON.stringify(e.tags ?? {}), iso(resolveTimestamp(event)),
      ];
    });
    const { text, values } = buildInsert(
      'metrics',
      ['project_id', 'org_id', 'metric_name', 'metric_type', 'value', 'unit',
       'count', 'sum', 'min', 'max', 'avg', 'buckets', 'tags', 'timestamp'],
      rows,
    );
    const r = await this.pool.query(text, values);
    return r.rowCount ?? 0;
  }

  private async writeLogs(list: LegacyScopedEvent[]): Promise<number> {
    const rows = list.map(({ projectId, orgId, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'log' }>;
      return [
        projectId, orgId, e.level, e.message, JSON.stringify(e.args ?? []),
        e.requestId ?? null, e.traceId ?? null, e.spanId ?? null, iso(resolveTimestamp(event)),
      ];
    });
    const { text, values } = buildInsert(
      'logs',
      ['project_id', 'org_id', 'level', 'message', 'args', 'request_id', 'trace_id', 'span_id', 'timestamp'],
      rows,
    );
    const r = await this.pool.query(text, values);
    return r.rowCount ?? 0;
  }

  private async writeCronCheckins(list: LegacyScopedEvent[]): Promise<number> {
    const rows = list.map(({ projectId, orgId, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'cron_checkin' }>;
      return [
        projectId, orgId, e.monitorSlug, e.status, e.duration ?? null,
        e.environment ?? null, iso(resolveTimestamp(event)),
      ];
    });
    const { text, values } = buildInsert(
      'cron_checkins',
      ['project_id', 'org_id', 'monitor_slug', 'status', 'duration_ms', 'environment', 'timestamp'],
      rows,
    );
    const r = await this.pool.query(text, values);
    return r.rowCount ?? 0;
  }

  private async writeReplays(list: LegacyScopedEvent[]): Promise<number> {
    const rows = list.map(({ projectId, orgId, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'replay' }>;
      return [
        projectId, orgId, e.sessionId, e.segmentId, JSON.stringify(e.events ?? []),
        iso(resolveTimestamp(event)),
      ];
    });
    const { text, values } = buildInsert(
      'replays',
      ['project_id', 'org_id', 'session_id', 'segment_id', 'events', 'timestamp'],
      rows,
    );
    const r = await this.pool.query(text, values);
    return r.rowCount ?? 0;
  }

  private async writeMessages(list: LegacyScopedEvent[]): Promise<number> {
    const rows = list.map(({ projectId, orgId, event }) => {
      const e = event as Extract<NormalizedEvent, { type: 'message' }>;
      return [
        projectId, orgId, e.message, e.severity ?? 'info',
        JSON.stringify(e.context ?? {}), JSON.stringify(e.breadcrumbs ?? []),
        e.requestId ?? null, e.traceId ?? null, e.spanId ?? null, iso(resolveTimestamp(event)),
      ];
    });
    const { text, values } = buildInsert(
      'messages',
      ['project_id', 'org_id', 'message', 'severity', 'context', 'breadcrumbs',
       'request_id', 'trace_id', 'span_id', 'timestamp'],
      rows,
    );
    const r = await this.pool.query(text, values);
    return r.rowCount ?? 0;
  }
}
