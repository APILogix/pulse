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
import type { WorkerMetrics } from './metrics-server.js';
export declare class UsageRollup {
    private readonly pool;
    private readonly metrics;
    private readonly log;
    private static ensuredPartitions;
    private readonly creditWeights;
    private timer;
    private running;
    private started;
    constructor(pool: Pool, metrics: WorkerMetrics, log: Logger);
    start(): Promise<void>;
    private runSafely;
    stop(): Promise<void>;
    /** One rollup pass. Throws on failure (staging preserved for next tick). */
    run(): Promise<void>;
}
//# sourceMappingURL=usage-rollup.d.ts.map