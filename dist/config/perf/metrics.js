/**
 * Prometheus Metrics for Database, Connection Pool & Cache Performance.
 *
 * Registered directly on the application's central Prometheus registry
 * (`src/config/metrics.ts`).
 *
 * Strict Cardinality Rules:
 * - NO org_id, user_id, request_id, raw SQL, or query parameters in labels.
 * - Route label is always normalized to route template patterns (e.g. /v1/org/:id).
 */
import promClient from 'prom-client';
import { register } from '../metrics.js';
export const dbQueryDurationHistogram = new promClient.Histogram({
    name: 'db_query_duration_seconds',
    help: 'Execution duration of individual database queries in seconds',
    labelNames: ['db', 'query', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [register],
});
export const dbPoolWaitHistogram = new promClient.Histogram({
    name: 'db_pool_wait_seconds',
    help: 'Time spent waiting to acquire a connection from the pool in seconds',
    labelNames: ['db'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5],
    registers: [register],
});
export const dbPoolConnectionsGauge = new promClient.Gauge({
    name: 'db_pool_connections',
    help: 'Number of pool connections by state (total, idle, waiting)',
    labelNames: ['db', 'state'],
    registers: [register],
});
export const dbQueriesPerRequestHistogram = new promClient.Histogram({
    name: 'db_queries_per_request',
    help: 'Number of database queries executed within a single HTTP request',
    labelNames: ['route'],
    buckets: [1, 2, 5, 10, 15, 20, 30, 50, 100],
    registers: [register],
});
export const cacheRequestsTotalCounter = new promClient.Counter({
    name: 'cache_requests_total',
    help: 'Total number of cache lookup requests',
    labelNames: ['cache', 'result'],
    registers: [register],
});
export const cacheOpDurationHistogram = new promClient.Histogram({
    name: 'cache_op_duration_seconds',
    help: 'Duration of cache operations in seconds',
    labelNames: ['op', 'cache'],
    buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1],
    registers: [register],
});
export const ingestBatchDurationHistogram = new promClient.Histogram({
    name: 'ingest_batch_duration_seconds',
    help: 'Duration of ingestion batch insert flushes to LogDB',
    labelNames: ['source', 'status'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [register],
});
export const ingestBatchRowsCounter = new promClient.Counter({
    name: 'ingest_batch_rows_total',
    help: 'Total rows processed in ingestion batch insert flushes',
    labelNames: ['source'],
    registers: [register],
});
/**
 * Periodically updates the db_pool_connections gauge for a given pool.
 */
export function registerPoolConnectionMetrics(db, pool, intervalMs = 5000) {
    const sample = () => {
        try {
            dbPoolConnectionsGauge.set({ db, state: 'total' }, pool.totalCount);
            dbPoolConnectionsGauge.set({ db, state: 'idle' }, pool.idleCount);
            dbPoolConnectionsGauge.set({ db, state: 'waiting' }, pool.waitingCount);
        }
        catch { }
    };
    sample();
    const timer = setInterval(sample, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
}
/**
 * Records cache request hit/miss counter safely.
 * Supports both recordCacheRequest('cache', 'hit') and recordCacheRequest('l1', 'cache', 'hit').
 */
export function recordCacheRequest(cacheOrLayer, resultOrCache, maybeResult) {
    try {
        if (maybeResult) {
            cacheRequestsTotalCounter.inc({ cache: resultOrCache, result: maybeResult });
        }
        else {
            cacheRequestsTotalCounter.inc({ cache: cacheOrLayer, result: resultOrCache });
        }
    }
    catch { }
}
/**
 * Records cache operation duration histogram safely.
 */
export function recordCacheOp(op, cache, durationMs) {
    try {
        cacheOpDurationHistogram.observe({ op, cache }, durationMs / 1000);
    }
    catch { }
}
//# sourceMappingURL=metrics.js.map