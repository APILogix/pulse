/**
 * Request Performance Context via Node.js AsyncLocalStorage.
 *
 * Propagates per-request context (requestId, route pattern, tier, query stats)
 * seamlessly across asynchronous database and cache calls without parameter threading.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../logger.js';
import type { DbQueryName } from './query-names.js';

const perfLogger = logger.child({ component: 'db-perf' });

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

export const perfContextStorage = new AsyncLocalStorage<RequestPerfStats>();

/**
 * Initializes a new performance tracking context for an incoming HTTP request or worker job.
 */
export function runWithPerfContext<T>(
  initial: {
    requestId: string;
    route: string;
    tier?: string;
    orgId?: string;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const stats: RequestPerfStats = {
    requestId: initial.requestId,
    route: initial.route,
    tier: initial.tier ?? 'default',
    orgId: initial.orgId,
    queryCount: 0,
    totalDbTimeMs: 0,
    totalPoolWaitMs: 0,
    cacheOpCount: 0,
    totalCacheTimeMs: 0,
    queryFrequency: new Map<string, number>(),
    nPlusOneLogged: false,
  };

  return perfContextStorage.run(stats, fn);
}

/**
 * Returns the active performance context if currently executing inside one.
 */
export function getActivePerfContext(): RequestPerfStats | undefined {
  return perfContextStorage.getStore();
}

/**
 * Updates stats in the active context and alerts on N+1 query patterns.
 */
export function recordContextQuery(
  queryName: DbQueryName | string,
  durationMs: number,
  poolWaitMs: number,
  maxAllowedQueries = 20,
): void {
  const store = perfContextStorage.getStore();
  if (!store) return;

  store.queryCount += 1;
  store.totalDbTimeMs += durationMs;
  store.totalPoolWaitMs += poolWaitMs;

  const currentCount = (store.queryFrequency.get(queryName) ?? 0) + 1;
  store.queryFrequency.set(queryName, currentCount);

  // Check N+1 threshold
  if (store.queryCount > maxAllowedQueries && !store.nPlusOneLogged) {
    store.nPlusOneLogged = true;

    const repeatedQueries: Array<{ query: string; count: number }> = [];
    for (const [name, count] of store.queryFrequency.entries()) {
      if (count > 2) {
        repeatedQueries.push({ query: name, count });
      }
    }

    perfLogger.warn(
      {
        requestId: store.requestId,
        route: store.route,
        tier: store.tier,
        orgId: store.orgId,
        queryCount: store.queryCount,
        totalDbTimeMs: Math.round(store.totalDbTimeMs * 100) / 100,
        repeatedQueries,
      },
      'N+1 database query pattern detected in request',
    );
  }
}

/**
 * Updates stats in the active context for cache operations.
 */
export function recordContextCache(durationMs: number): void {
  const store = perfContextStorage.getStore();
  if (!store) return;

  store.cacheOpCount += 1;
  store.totalCacheTimeMs += durationMs;
}
