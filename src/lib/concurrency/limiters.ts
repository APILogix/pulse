import pLimit from 'p-limit';

// Global limits for external bounds
export const globalDbLimit = pLimit(Number(process.env.DB_MAX_CONCURRENCY || 50));
export const globalApiLimit = pLimit(Number(process.env.API_MAX_CONCURRENCY || 20));
export const globalRedisLimit = pLimit(Number(process.env.REDIS_MAX_CONCURRENCY || 100));

/**
 * Creates a configurable concurrency limiter for a specific operation.
 */
export function createLimiter(concurrency: number) {
  return pLimit(concurrency);
}
