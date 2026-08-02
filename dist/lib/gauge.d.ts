export interface GaugeState {
    pendingDepth: number;
    updatedAt: Date;
    lastWorkerId?: string | null;
}
type Queryable = {
    query: (sql: string, params?: unknown[]) => Promise<{
        rows: Array<Record<string, unknown>>;
    }>;
};
/**
 * Cross-process backpressure gauge.
 *
 * After the pg-boss cutover there is no writer-side singleton row: the gauge
 * reads the pg-boss job table directly (pending = created + retry across the
 * ingest.<type> queues), so every API process sees the same live depth. Reads
 * fail open (return null) so readiness policy decides how to react.
 */
export declare class BackpressureGauge {
    private readonly db;
    constructor(db: Queryable);
    read(): Promise<GaugeState | null>;
    /**
     * @deprecated No-op since the pg-boss cutover — depth is read live from
     * pgboss.job; nothing needs to write the gauge. Retained so legacy callers
     * still compile.
     */
    update(_depth: number, _workerId: string): Promise<void>;
    isStale(state: GaugeState, maxAgeMs: number): boolean;
}
export {};
//# sourceMappingURL=gauge.d.ts.map