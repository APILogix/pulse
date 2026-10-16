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
import type { Pool } from 'pg';
export declare const dbQueryDurationHistogram: promClient.Histogram<"query" | "db" | "status">;
export declare const dbPoolWaitHistogram: promClient.Histogram<"db">;
export declare const dbPoolConnectionsGauge: promClient.Gauge<"state" | "db">;
export declare const dbQueriesPerRequestHistogram: promClient.Histogram<"route">;
export declare const cacheRequestsTotalCounter: promClient.Counter<"cache" | "result">;
export declare const cacheOpDurationHistogram: promClient.Histogram<"cache" | "op">;
export declare const ingestBatchDurationHistogram: promClient.Histogram<"status" | "source">;
export declare const ingestBatchRowsCounter: promClient.Counter<"source">;
/**
 * Periodically updates the db_pool_connections gauge for a given pool.
 */
export declare function registerPoolConnectionMetrics(db: 'control' | 'telemetry', pool: Pool, intervalMs?: number): () => void;
/**
 * Records cache request hit/miss counter safely.
 * Supports both recordCacheRequest('cache', 'hit') and recordCacheRequest('l1', 'cache', 'hit').
 */
export declare function recordCacheRequest(cacheOrLayer: string, resultOrCache: string, maybeResult?: 'hit' | 'miss'): void;
/**
 * Records cache operation duration histogram safely.
 */
export declare function recordCacheOp(op: 'get' | 'set' | 'mget' | 'del', cache: string, durationMs: number): void;
//# sourceMappingURL=metrics.d.ts.map