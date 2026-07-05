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
 * The singleton row is shared by all API and worker processes through Postgres.
 * Workers write; API servers read. Reads are O(1) and intentionally fail open
 * to the caller so readiness policy decides how to react.
 */
export declare class BackpressureGauge {
    private readonly db;
    constructor(db: Queryable);
    read(): Promise<GaugeState | null>;
    update(depth: number, workerId: string): Promise<void>;
    isStale(state: GaugeState, maxAgeMs: number): boolean;
}
export {};
//# sourceMappingURL=gauge.d.ts.map