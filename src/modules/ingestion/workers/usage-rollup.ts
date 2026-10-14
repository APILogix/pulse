/**
 * UsageRollup — singleton rollup that rolls billing usage counters forward.
 *
 * Runs on a configured interval (default every 60s) in the worker process.
 * This is the ONLY component allowed to roll staging into
 * the billing tables — every UsageCounter in the fleet runs driveRollup:false.
 *
 * Each run, in ONE client transaction:
 *   a. Ensure usage_daily_counters monthly partitions exist for the current
 *      and next month.
 *   b. Atomically DELETE ... RETURNING the `billing:%` rows from
 *      usage_counter_staging, then aggregate in code per (org, project, type) and per org.
 *   c. Per org: SELECT increment_event_usage(org, orgTotal) — the fast-path
 *      entitlement counter (organization_usage_current_period.events_used).
 *   d. Per (org, project): upsert usage_daily_counters for CURRENT_DATE.
 *   e. COMMIT. A failure rolls the whole transaction back.
 *
 * AFTER the commit (outside the tx) it invokes flush_usage_counters()
 * so non-billing counters roll into project_usage.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { env } from '../../../config/env.js';
import type { WorkerMetrics } from './metrics-server.js';
import { CreditWeightService } from '../usage/credit-weights.js';

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

const BULK_ENTITLEMENT_UPDATE_SQL = `
  UPDATE organization_usage_current_period o
     SET events_used = o.events_used + u.delta,
         raw_events_count = o.raw_events_count + u.raw_delta,
         last_event_at = NOW(),
         updated_at = NOW()
    FROM (
      SELECT UNNEST($1::uuid[]) AS org_id,
             UNNEST($2::numeric[]) AS delta,
             UNNEST($3::bigint[]) AS raw_delta
    ) u
   WHERE o.organization_id = u.org_id
`;

const BULK_DAILY_UPSERT_SQL = `
  INSERT INTO usage_daily_counters
    (organization_id, project_id, usage_date, events_count, ${COUNTER_COLUMNS.join(', ')})
  SELECT t.org_id, t.project_id, CURRENT_DATE, t.events_count,
         ${COUNTER_COLUMNS.map((col) => `t.${col}`).join(', ')}
  FROM UNNEST(
    $1::uuid[],
    $2::uuid[],
    $3::bigint[],
    ${COUNTER_COLUMNS.map((_, i) => `$${i + 4}::bigint[]`).join(',\n    ')}
  ) AS t(org_id, project_id, events_count, ${COUNTER_COLUMNS.join(', ')})
  ON CONFLICT (organization_id, project_id, usage_date) DO UPDATE SET
    events_count = usage_daily_counters.events_count + EXCLUDED.events_count,
    ${COUNTER_COLUMNS.map((c) => `${c} = usage_daily_counters.${c} + EXCLUDED.${c}`).join(',\n    ')}
`;

export class UsageRollup {
  private static ensuredPartitions = new Set<string>();
  private readonly creditWeights: CreditWeightService;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private started = false;

  constructor(
    private readonly pool: Pool,
    private readonly metrics: WorkerMetrics,
    private readonly log: Logger,
  ) {
    this.creditWeights = new CreditWeightService(pool, log);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    void this.creditWeights.loadWeights().catch(() => {});

    // Run once at start, then every 60s
    void this.runSafely();
    this.timer = setInterval(() => void this.runSafely(), 60_000);
    this.timer.unref?.();
    this.log.info('Usage rollup interval started');
  }

  private async runSafely(): Promise<void> {
    if (this.running || !this.started) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.log.error({ err }, 'Usage rollup execution failed');
    } finally {
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One rollup pass. Throws on failure (staging preserved for next tick). */
  async run(): Promise<void> {
    const startedAt = Date.now();
    const client = await this.pool.connect();
    const orgTotals = new Map<string, number>();
    const scopes = new Map<string, ScopeAcc>();
    let stagingRows = 0;
    let eventsTotal = 0;

    try {
      await client.query('BEGIN');

      // (a) Partitions for the current and next month (cached per month to avoid repeated DDL).
      for (const offset of [0, 1]) {
        const p = monthPartition(offset);
        if (!UsageRollup.ensuredPartitions.has(p.name)) {
          await client.query(
            `CREATE TABLE IF NOT EXISTS ${p.name} PARTITION OF usage_daily_counters FOR VALUES FROM ('${p.from}') TO ('${p.to}')`,
          );
          UsageRollup.ensuredPartitions.add(p.name);
        }
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
      if (stagingRows === 0) {
        await client.query('COMMIT');
        return;
      }

      const rawOrgTotals = new Map<string, number>();

      for (const row of extracted.rows) {
        const count = Number(row.increment_by) || 0;
        if (count <= 0) continue;

        // Check if raw unweighted counter
        if (row.counter_type.startsWith('billing:raw:')) {
          const rawType = row.counter_type.slice('billing:raw:'.length);
          const currentRaw = rawOrgTotals.get(row.org_id) ?? 0;
          rawOrgTotals.set(row.org_id, currentRaw + count);

          const scopeKey = `${row.org_id}|${row.project_id}`;
          let scope = scopes.get(scopeKey);
          if (!scope) {
            scope = {
              orgId: row.org_id,
              projectId: row.project_id,
              byColumn: new Map(),
              total: 0,
            };
            scopes.set(scopeKey, scope);
          }
          const col = TYPE_TO_COLUMN[rawType];
          if (col) {
            scope.byColumn.set(col, (scope.byColumn.get(col) ?? 0) + count);
          }
          continue;
        }

        // Weighted billing credits counter
        eventsTotal += count;

        const currentOrg = orgTotals.get(row.org_id) ?? 0;
        orgTotals.set(row.org_id, currentOrg + count);

        const scopeKey = `${row.org_id}|${row.project_id}`;
        let scope = scopes.get(scopeKey);
        if (!scope) {
          scope = {
            orgId: row.org_id,
            projectId: row.project_id,
            byColumn: new Map(),
            total: 0,
          };
          scopes.set(scopeKey, scope);
        }
        scope.total += count;

        const eventType = row.counter_type.startsWith(BILLING_COUNTER_PREFIX)
          ? row.counter_type.slice(BILLING_COUNTER_PREFIX.length)
          : row.counter_type;
        const col = TYPE_TO_COLUMN[eventType];
        if (col && !scope.byColumn.has(col)) {
          const weight = this.creditWeights.getWeightSync(eventType);
          const rawEstimate = Math.round(count / weight);
          scope.byColumn.set(col, (scope.byColumn.get(col) ?? 0) + rawEstimate);
        }
      }

      // (c) Fast-path entitlement updates (Bulk set-based).
      const allOrgs = Array.from(new Set([...orgTotals.keys(), ...rawOrgTotals.keys()]));
      if (allOrgs.length > 0) {
        const orgIds = allOrgs;
        const deltas = allOrgs.map((orgId) => orgTotals.get(orgId) ?? 0);
        const rawDeltas = allOrgs.map((orgId) => {
          if (rawOrgTotals.has(orgId)) {
            return Math.round(rawOrgTotals.get(orgId)!);
          }
          return Math.round(orgTotals.get(orgId) ?? 0);
        });
        await client.query(BULK_ENTITLEMENT_UPDATE_SQL, [orgIds, deltas, rawDeltas]);
      }

      // (d) Daily breakdown upserts (Bulk set-based).
      if (scopes.size > 0) {
        const scopeList = Array.from(scopes.values());
        const BATCH_SIZE = 500;
        for (let i = 0; i < scopeList.length; i += BATCH_SIZE) {
          const batch = scopeList.slice(i, i + BATCH_SIZE);
          const orgIds = batch.map((s) => s.orgId);
          const projectIds = batch.map((s) => s.projectId);
          const totals = batch.map((s) => Math.ceil(s.total));
          const colArrays = COUNTER_COLUMNS.map((col) =>
            batch.map((s) => s.byColumn.get(col) ?? 0),
          );
          await client.query(BULK_DAILY_UPSERT_SQL, [
            orgIds,
            projectIds,
            totals,
            ...colArrays,
          ]);
        }
      }

      await client.query('COMMIT');

      // (e) Flush non-billing staging counters.
      await this.pool.query(`SELECT flush_usage_counters()`).catch((err) => {
        this.log.warn({ err }, 'flush_usage_counters() failed after rollup commit');
      });

      this.metrics.recordRollupSuccess({
        durationMs: Date.now() - startedAt,
        stagingRows,
        events: eventsTotal,
        orgs: orgTotals.size,
        projects: scopes.size,
      });
      this.log.info(
        {
          durationMs: Date.now() - startedAt,
          stagingRows,
          eventsTotal,
          organizations: orgTotals.size,
          scopes: scopes.size,
        },
        'Usage rollup complete',
      );
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      this.metrics.recordRollupFailure(Date.now() - startedAt);
      this.log.error({ err }, 'Usage rollup failed');
      throw err;
    } finally {
      client.release();
    }
  }
}
