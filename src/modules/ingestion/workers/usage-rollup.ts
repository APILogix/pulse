/**
 * UsageRollup — singleton cron that rolls the billing usage counters forward.
 *
 * Scheduled via pg-boss (`ingest.usage-rollup`, env.INGESTION_USAGE_ROLLUP_CRON,
 * singletonKey 'usage-rollup') so exactly one run executes per tick across all
 * worker processes. This is the ONLY component allowed to roll staging into
 * the billing tables — every UsageCounter in the fleet runs driveRollup:false.
 *
 * Each run, in ONE client transaction:
 *   a. Ensure usage_daily_counters monthly partitions exist for the current
 *      and next month (a `usage_daily_counters_default` DEFAULT partition is
 *      the safety net; missing partitions would silently absorb rows there).
 *   b. Atomically DELETE ... RETURNING the `billing:%` rows from
 *      usage_counter_staging (concurrent increments are NEW rows, untouched),
 *      then aggregate in code per (org, project, type) and per org.
 *   c. Per org: SELECT increment_event_usage(org, orgTotal) — the fast-path
 *      entitlement counter (organization_usage_current_period.events_used).
 *   d. Per (org, project): upsert usage_daily_counters for CURRENT_DATE —
 *      type→column mapping, and events_count ALWAYS incremented by the total.
 *   e. COMMIT. A failure rolls the whole transaction back: staging rows are
 *      preserved and the next tick retries — at-least-once with no loss and
 *      no double-apply.
 *
 * AFTER the commit (outside the tx) it invokes the existing
 * flush_usage_counters() so the remaining non-billing counters still roll into
 * project_usage. Time-window aggregation only — NO per-event billing writes.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { env } from '../../../config/env.js';
import { pgboss } from '../../../lib/pgboss.js';
import {
  INGEST_USAGE_ROLLUP_QUEUE,
  type UsageRollupPayload,
} from '../queue/ingest-queues.js';
import type { WorkerMetrics } from './metrics-server.js';

const BILLING_COUNTER_PREFIX = 'billing:events:';

/** event type → usage_daily_counters column; null = counts into events_count only. */
const TYPE_TO_COLUMN: Record<string, string | null> = {
  request: 'requests_count',
  error: 'errors_count',
  trace: 'traces_count',
  span: 'spans_count',
  metric: 'metrics_count',
  log: 'logs_count',
  profile: 'profiles_count',
  replay: 'replays_count',
  message: null,
  cron_checkin: null,
};

const COUNTER_COLUMNS = [
  'requests_count',
  'errors_count',
  'traces_count',
  'spans_count',
  'metrics_count',
  'logs_count',
  'profiles_count',
  'replays_count',
] as const;

interface ScopeAcc {
  orgId: string;
  projectId: string;
  byColumn: Map<string, number>;
  total: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Monthly partition descriptor for `usage_daily_counters`, offset in months. */
function monthPartition(offsetMonths: number): { name: string; from: string; to: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths + 1, 1));
  const ymd = (d: Date): string => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return {
    name: `usage_daily_counters_${first.getUTCFullYear()}_${pad2(first.getUTCMonth() + 1)}`,
    from: ymd(first),
    to: ymd(next),
  };
}

const DAILY_UPSERT_SQL = `
  INSERT INTO usage_daily_counters
    (organization_id, project_id, usage_date, events_count, ${COUNTER_COLUMNS.join(', ')})
  VALUES ($1, $2, CURRENT_DATE, $3, ${COUNTER_COLUMNS.map((_, i) => `$${i + 4}`).join(', ')})
  ON CONFLICT (organization_id, project_id, usage_date) DO UPDATE SET
    events_count = usage_daily_counters.events_count + EXCLUDED.events_count,
    ${COUNTER_COLUMNS.map((c) => `${c} = usage_daily_counters.${c} + EXCLUDED.${c}`).join(',\n    ')}`;

export class UsageRollup {
  constructor(
    private readonly pool: Pool,
    private readonly metrics: WorkerMetrics,
    private readonly log: Logger,
  ) {}

  /** Register the worker + the singleton cron schedule. Call after pgboss.start(). */
  async start(): Promise<void> {
    await pgboss.work(
      INGEST_USAGE_ROLLUP_QUEUE,
      { localConcurrency: 1, batchSize: 1 } as never,
      (async () => {
        await this.run();
      }) as never,
    );
    await pgboss.schedule(
      INGEST_USAGE_ROLLUP_QUEUE,
      env.INGESTION_USAGE_ROLLUP_CRON,
      { triggeredAt: new Date().toISOString() } satisfies UsageRollupPayload,
      { singletonKey: 'usage-rollup' } as never,
    );
    this.log.info({ cron: env.INGESTION_USAGE_ROLLUP_CRON }, 'Usage rollup scheduled');
  }

  async stop(): Promise<void> {
    await pgboss.unschedule(INGEST_USAGE_ROLLUP_QUEUE).catch(() => undefined);
    await pgboss.offWork(INGEST_USAGE_ROLLUP_QUEUE).catch(() => undefined);
  }

  /** One rollup pass. Throws on failure (staging preserved for the next tick). */
  async run(): Promise<void> {
    const startedAt = Date.now();
    const client = await this.pool.connect();
    const orgTotals = new Map<string, number>();
    const scopes = new Map<string, ScopeAcc>();
    let stagingRows = 0;
    let eventsTotal = 0;

    try {
      await client.query('BEGIN');

      // (a) Partitions for the current and next month.
      for (const offset of [0, 1]) {
        const p = monthPartition(offset);
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${p.name} PARTITION OF usage_daily_counters FOR VALUES FROM ('${p.from}') TO ('${p.to}')`,
        );
      }

      // (b) Atomic extract of the billing counters.
      const extracted = await client.query<{
        org_id: string;
        project_id: string;
        counter_type: string;
        increment_by: string;
      }>(
        `DELETE FROM usage_counter_staging
         WHERE counter_type LIKE 'billing:%'
         RETURNING org_id, project_id, counter_type, increment_by`,
      );
      stagingRows = extracted.rowCount ?? 0;
      for (const row of extracted.rows) {
        const n = Number(row.increment_by) || 0;
        if (n <= 0) continue;
        const type = row.counter_type.startsWith(BILLING_COUNTER_PREFIX)
          ? row.counter_type.slice(BILLING_COUNTER_PREFIX.length)
          : 'unknown';
        orgTotals.set(row.org_id, (orgTotals.get(row.org_id) ?? 0) + n);
        const key = `${row.org_id}|${row.project_id}`;
        let acc = scopes.get(key);
        if (!acc) {
          acc = { orgId: row.org_id, projectId: row.project_id, byColumn: new Map(), total: 0 };
          scopes.set(key, acc);
        }
        const column = TYPE_TO_COLUMN[type];
        if (column) acc.byColumn.set(column, (acc.byColumn.get(column) ?? 0) + n);
        acc.total += n;
        eventsTotal += n;
      }

      // (c) Org-level fast-path entitlement counters.
      for (const [orgId, total] of orgTotals) {
        await client.query('SELECT increment_event_usage($1, $2)', [orgId, total]);
      }

      // (d) Per (org, project, day) historical counters.
      for (const acc of scopes.values()) {
        await client.query(DAILY_UPSERT_SQL, [
          acc.orgId,
          acc.projectId,
          acc.total,
          ...COUNTER_COLUMNS.map((c) => acc.byColumn.get(c) ?? 0),
        ]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.metrics.recordRollupFailure(Date.now() - startedAt);
      this.log.error({ err }, 'Usage rollup failed — transaction rolled back, staging preserved');
      throw err;
    } finally {
      client.release();
    }

    // (e) Non-billing counters still roll into project_usage — outside the tx.
    try {
      await this.pool.query('SELECT flushed_count FROM flush_usage_counters()');
    } catch (err) {
      this.log.warn({ err }, 'flush_usage_counters() failed after usage rollup');
    }

    this.metrics.recordRollupSuccess({
      durationMs: Date.now() - startedAt,
      stagingRows,
      events: eventsTotal,
      orgs: orgTotals.size,
      projects: scopes.size,
    });
    this.log.info(
      { stagingRows, events: eventsTotal, orgs: orgTotals.size, projects: scopes.size, ms: Date.now() - startedAt },
      'Usage rollup complete',
    );
  }
}
