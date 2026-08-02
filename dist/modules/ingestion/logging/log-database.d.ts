import type { Logger } from 'pino';
export interface MetricTags {
    [key: string]: string | number | boolean;
}
export interface WriteMetricOptions {
    projectId?: string | null;
    orgId?: string | null;
    tags?: MetricTags;
    metadata?: Record<string, unknown>;
}
export interface WorkerPerformanceRecord {
    workerId: string;
    workerType: string;
    jobsProcessed: number;
    jobsFailed?: number;
    avgDurationMs?: number;
    p95DurationMs?: number;
    batchSize?: number;
    pollCycles?: number;
    metadata?: Record<string, unknown>;
}
export interface AdminAuditRecord {
    logLevel: string;
    category: string;
    message: string;
    orgId?: string | null;
    projectId?: string | null;
    jobId?: string | null;
    eventId?: string | null;
    workerId?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: Date;
}
export interface MetricPoint {
    time: string;
    metric_name: string;
    value: number;
    project_id: string | null;
    tags: Record<string, unknown>;
}
export declare class LogDatabase {
    private readonly log;
    private pool;
    private enabled;
    private initialized;
    constructor(log: Logger);
    /** True once initialize() succeeded against a configured TimescaleDB. */
    isEnabled(): boolean;
    /**
     * Create the pool, extensions, hypertables, continuous aggregate and
     * retention policies. Safe to call once at worker startup. Idempotent on the
     * DB side (all DDL guarded with IF NOT EXISTS). When TIMESCALEDB_URL is unset
     * this is a no-op that logs an info line and leaves the instance disabled.
     */
    initialize(): Promise<void>;
    private createSchema;
    /** Insert one metric point. No-op when disabled. Never throws. */
    writeMetric(name: string, value: number, opts?: WriteMetricOptions): Promise<void>;
    /** Insert a per-worker performance row. No-op when disabled. Never throws. */
    writeWorkerPerformance(rec: WorkerPerformanceRecord): Promise<void>;
    /** Bulk insert admin audit rows (called by AdminLogger). No-op when disabled. */
    writeAdminAudit(records: AdminAuditRecord[]): Promise<void>;
    /** Query historical metric points. Returns [] when disabled. */
    queryMetrics(name: string, timeRange: {
        from: Date;
        to: Date;
    }, projectId?: string): Promise<MetricPoint[]>;
    /** Close the pool. */
    end(): Promise<void>;
}
//# sourceMappingURL=log-database.d.ts.map