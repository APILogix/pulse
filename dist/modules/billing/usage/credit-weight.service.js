/**
 * Default credit weights schedule matching the billing_event_credit_weights seeder.
 * Used as fallback on initial cold start or if the database is unreachable.
 */
export const DEFAULT_CREDIT_WEIGHTS = Object.freeze({
    request: 1.0000,
    error: 1.5000,
    trace: 0.5000,
    span: 0.2500,
    log: 0.1200,
    metric: 0.1000,
    profile: 2.0000,
    replay: 2.0000,
    message: 0.3000,
    cron_checkin: 0.2000,
});
/**
 * CreditWeightService
 *
 * In-memory caching service for telemetry event credit weights.
 * Guarantees O(1) synchronous lookup performance on the critical ingestion hot path
 * while periodically synchronizing active weights from the PostgreSQL database in the background.
 */
export class CreditWeightService {
    pool;
    log;
    static instance = null;
    weights = new Map(Object.entries(DEFAULT_CREDIT_WEIGHTS));
    refreshTimer = null;
    refreshPromise = null;
    lastRefreshedAt = 0;
    isInitialized = false;
    refreshIntervalMs;
    constructor(pool, log, options = {}) {
        this.pool = pool;
        this.log = log;
        this.refreshIntervalMs = options.refreshIntervalMs ?? 5 * 60 * 1000; // 5 minutes default
    }
    /**
     * Returns the process-wide singleton instance of CreditWeightService.
     */
    static getInstance(pool, log, options) {
        if (!CreditWeightService.instance) {
            CreditWeightService.instance = new CreditWeightService(pool, log, options);
        }
        return CreditWeightService.instance;
    }
    /**
     * Allows replacing or resetting the singleton instance (useful for testing).
     */
    static setInstance(instance) {
        CreditWeightService.instance = instance;
    }
    /**
     * Starts periodic background cache refresh.
     */
    start() {
        if (this.refreshTimer)
            return;
        void this.refreshCache().catch(() => { });
        this.refreshTimer = setInterval(() => {
            void this.refreshCache().catch(() => { });
        }, this.refreshIntervalMs);
        this.refreshTimer.unref?.();
        this.log?.info?.({ refreshIntervalMs: this.refreshIntervalMs }, 'CreditWeightService background refresh started');
    }
    /**
     * Stops the background refresh timer cleanly during graceful shutdown.
     */
    stop() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        this.log?.info?.('CreditWeightService stopped');
    }
    /**
     * Fast synchronous O(1) lookup on the critical telemetry ingestion hot path.
     * Never blocks or makes database round-trips.
     *
     * @param eventType Telemetry event type (e.g., 'request', 'error', 'span', 'log')
     * @returns Credit weight multiplier (defaults to 1.0 if unknown)
     */
    getWeightSync(eventType) {
        if (!this.isInitialized && !this.refreshPromise) {
            void this.refreshCache().catch(() => { });
        }
        return this.weights.get(eventType) ?? DEFAULT_CREDIT_WEIGHTS[eventType] ?? 1.0;
    }
    /**
     * Asynchronous weight lookup conforming to the standard service interface.
     * Ensures the initial cache is hydrated before returning.
     *
     * @param eventType Telemetry event type (e.g., 'request', 'error', 'span', 'log')
     * @returns Promise resolving to the credit weight multiplier
     */
    async getWeight(eventType) {
        if (!this.isInitialized) {
            await this.refreshCache().catch(() => { });
        }
        return this.getWeightSync(eventType);
    }
    /**
     * Refreshes the in-memory cache by querying active weights from PostgreSQL.
     * Includes stampede protection: concurrent calls join the same in-flight query.
     * Swaps the map atomically so readers never observe an inconsistent state.
     */
    async refreshCache() {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        const run = async () => {
            const startedAt = Date.now();
            try {
                let dbPool = this.pool;
                if (!dbPool) {
                    try {
                        const dbModule = await import('../../../config/database.js');
                        dbPool = dbModule.pool;
                    }
                    catch {
                        // If database module cannot be loaded, rely on cached/default weights
                        this.isInitialized = true;
                        return;
                    }
                }
                const res = await dbPool.query(`SELECT event_type, credit_weight 
             FROM billing_event_credit_weights 
            WHERE is_active = true`);
                // Pre-populate with default schedule then overlay active database values
                const nextWeights = new Map(Object.entries(DEFAULT_CREDIT_WEIGHTS));
                for (const row of res.rows) {
                    const val = Number(row.credit_weight);
                    if (!Number.isNaN(val) && val > 0) {
                        nextWeights.set(row.event_type, val);
                    }
                }
                // Atomic swap
                this.weights = nextWeights;
                this.lastRefreshedAt = Date.now();
                this.isInitialized = true;
                this.log?.info?.({
                    durationMs: Date.now() - startedAt,
                    weightsCount: this.weights.size,
                    activeDatabaseRows: res.rowCount,
                }, 'CreditWeightService cache refreshed successfully');
            }
            catch (err) {
                this.isInitialized = true; // Mark initialized to fall back to existing cache
                this.log?.warn?.({ err, existingCount: this.weights.size }, 'Failed to refresh billing_event_credit_weights; preserving existing cache and defaults');
            }
        };
        this.refreshPromise = run().finally(() => {
            this.refreshPromise = null;
        });
        return this.refreshPromise;
    }
    /**
     * Alias for refreshCache() for backwards compatibility with earlier loaders.
     */
    loadWeights() {
        return this.refreshCache();
    }
    /**
     * Returns a snapshot of all currently cached event weights.
     */
    getAllWeights() {
        return Object.fromEntries(this.weights.entries());
    }
    /**
     * Timestamp (epoch ms) of the last successful database cache refresh.
     */
    getLastRefreshedAt() {
        return this.lastRefreshedAt;
    }
}
export const getCreditWeightService = (pool, log) => CreditWeightService.getInstance(pool, log);
export const creditWeightService = CreditWeightService.getInstance();
//# sourceMappingURL=credit-weight.service.js.map