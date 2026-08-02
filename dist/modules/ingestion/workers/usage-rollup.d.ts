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
import type { WorkerMetrics } from './metrics-server.js';
export declare class UsageRollup {
    private readonly pool;
    private readonly metrics;
    private readonly log;
    constructor(pool: Pool, metrics: WorkerMetrics, log: Logger);
    /** Register the worker + the singleton cron schedule. Call after pgboss.start(). */
    start(): Promise<void>;
    stop(): Promise<void>;
    /** One rollup pass. Throws on failure (staging preserved for the next tick). */
    run(): Promise<void>;
}
//# sourceMappingURL=usage-rollup.d.ts.map