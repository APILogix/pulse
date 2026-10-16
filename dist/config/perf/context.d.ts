/**
 * Request Performance Context via Node.js AsyncLocalStorage.
 *
 * Propagates per-request context (requestId, route pattern, tier, query stats)
 * seamlessly across asynchronous database and cache calls without parameter threading.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DbQueryName } from './query-names.js';
export interface RequestPerfStats {
    requestId: string;
    route: string;
    tier: string;
    orgId?: string | undefined;
    queryCount: number;
    totalDbTimeMs: number;
    totalPoolWaitMs: number;
    cacheOpCount: number;
    totalCacheTimeMs: number;
    queryFrequency: Map<string, number>;
    nPlusOneLogged?: boolean;
}
export declare const perfContextStorage: AsyncLocalStorage<RequestPerfStats>;
/**
 * Initializes a new performance tracking context for an incoming HTTP request or worker job.
 */
export declare function runWithPerfContext<T>(initial: {
    requestId: string;
    route: string;
    tier?: string;
    orgId?: string;
}, fn: () => Promise<T>): Promise<T>;
/**
 * Returns the active performance context if currently executing inside one.
 */
export declare function getActivePerfContext(): RequestPerfStats | undefined;
/**
 * Updates stats in the active context and alerts on N+1 query patterns.
 */
export declare function recordContextQuery(queryName: DbQueryName | string, durationMs: number, poolWaitMs: number, maxAllowedQueries?: number): void;
/**
 * Updates stats in the active context for cache operations.
 */
export declare function recordContextCache(durationMs: number): void;
//# sourceMappingURL=context.d.ts.map