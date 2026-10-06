import type { Pool } from 'pg';
import type { Logger } from 'pino';
export declare class WorkerRegistry {
    private readonly pool;
    private readonly log;
    private readonly metrics;
    private readonly processor;
    private readonly rollup;
    private readonly metricsServer;
    /** Tenant fairness: per-org in-flight job count for THIS process. */
    private readonly inFlight;
    private readonly workerInFlight;
    /** Active PGMQ Workers */
    private readonly workers;
    private started;
    private startPromise;
    constructor(pool: Pool, log: Logger, telemetryPool?: Pool);
    /** Provision queues, then register every worker + cron + metrics. */
    start(): Promise<void>;
    private startInternal;
    /** Stop every PGMQ worker and drain running services. */
    stop(): Promise<void>;
    private handleSingleIngestJob;
    private runOne;
    private persistDeadLetter;
    private insertDeadLetter;
}
//# sourceMappingURL=worker-registry.d.ts.map