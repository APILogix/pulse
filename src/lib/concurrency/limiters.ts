import pLimit from 'p-limit';

// These limiters are intentionally local to this Node.js process.
// Cross-process backpressure is driven by the database gauge, not in-memory state.
export const localApiLimit = pLimit(Number(process.env.API_MAX_CONCURRENCY || 20));
export const localRedisLimit = pLimit(Number(process.env.REDIS_MAX_CONCURRENCY || 100));

/**
 * Creates a configurable concurrency limiter for a specific operation.
 */
export function createLimiter(concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer');
  }

  return pLimit(concurrency);
}
