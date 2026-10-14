import type { Pool } from 'pg';
import type { Logger } from 'pino';
/**
 * Default credit weights schedule matching the billing_event_credit_weights seeder.
 * Used as fallback on initial cold start or if the database is unreachable.
 */
export declare const DEFAULT_CREDIT_WEIGHTS: Readonly<Record<string, number>>;
export interface CreditWeightServiceOptions {
    /** Periodic refresh interval in milliseconds. Defaults to 5 minutes (300,000 ms). */
    refreshIntervalMs?: number;
    /** Whether to initialize weights on instantiation. Defaults to true. */
    lazyLoadOnStart?: boolean;
}
/**
 * CreditWeightService
 *
 * In-memory caching service for telemetry event credit weights.
 * Guarantees O(1) synchronous lookup performance on the critical ingestion hot path
 * while periodically synchronizing active weights from the PostgreSQL database in the background.
 */
export declare class CreditWeightService {
    private readonly pool?;
    private readonly log?;
    private static instance;
    private weights;
    private refreshTimer;
    private refreshPromise;
    private lastRefreshedAt;
    private isInitialized;
    private readonly refreshIntervalMs;
    constructor(pool?: Pool | undefined, log?: Logger | undefined, options?: CreditWeightServiceOptions);
    /**
     * Returns the process-wide singleton instance of CreditWeightService.
     */
    static getInstance(pool?: Pool, log?: Logger, options?: CreditWeightServiceOptions): CreditWeightService;
    /**
     * Allows replacing or resetting the singleton instance (useful for testing).
     */
    static setInstance(instance: CreditWeightService | null): void;
    /**
     * Starts periodic background cache refresh.
     */
    start(): void;
    /**
     * Stops the background refresh timer cleanly during graceful shutdown.
     */
    stop(): void;
    /**
     * Fast synchronous O(1) lookup on the critical telemetry ingestion hot path.
     * Never blocks or makes database round-trips.
     *
     * @param eventType Telemetry event type (e.g., 'request', 'error', 'span', 'log')
     * @returns Credit weight multiplier (defaults to 1.0 if unknown)
     */
    getWeightSync(eventType: string): number;
    /**
     * Asynchronous weight lookup conforming to the standard service interface.
     * Ensures the initial cache is hydrated before returning.
     *
     * @param eventType Telemetry event type (e.g., 'request', 'error', 'span', 'log')
     * @returns Promise resolving to the credit weight multiplier
     */
    getWeight(eventType: string): Promise<number>;
    /**
     * Refreshes the in-memory cache by querying active weights from PostgreSQL.
     * Includes stampede protection: concurrent calls join the same in-flight query.
     * Swaps the map atomically so readers never observe an inconsistent state.
     */
    refreshCache(): Promise<void>;
    /**
     * Alias for refreshCache() for backwards compatibility with earlier loaders.
     */
    loadWeights(): Promise<void>;
    /**
     * Returns a snapshot of all currently cached event weights.
     */
    getAllWeights(): Record<string, number>;
    /**
     * Timestamp (epoch ms) of the last successful database cache refresh.
     */
    getLastRefreshedAt(): number;
}
export declare const getCreditWeightService: (pool?: Pool, log?: Logger) => CreditWeightService;
export declare const creditWeightService: CreditWeightService;
//# sourceMappingURL=credit-weight.service.d.ts.map