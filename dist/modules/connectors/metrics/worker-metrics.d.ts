/**
 * In-process metrics collector for the Connector Worker system.
 *
 * Exposes runtime counts for observability, avoiding a full Prometheus
 * dependency while providing enough data for /health or /metrics endpoints.
 */
export interface ConnectorMetricsSnapshot {
    timestamp: string;
    counters: {
        jobsProcessed: number;
        jobsFailed: number;
        jobsRetried: number;
    };
    gauges: {
        activeJobs: number;
    };
    circuitStates: Record<string, 'open' | 'closed' | 'half_open'>;
}
declare class WorkerMetrics {
    private jobsProcessed;
    private jobsFailed;
    private jobsRetried;
    private activeJobs;
    recordJobStarted(): void;
    recordJobCompleted(): void;
    recordJobFailed(retryable: boolean): void;
    getSnapshot(circuitStates?: Record<string, 'open' | 'closed' | 'half_open'>): ConnectorMetricsSnapshot;
}
export declare const workerMetrics: WorkerMetrics;
export {};
//# sourceMappingURL=worker-metrics.d.ts.map