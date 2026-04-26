import { Redis } from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,           // Connect on first use
  keyPrefix: 'api-mon:',
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
});

export const closeRedis = async () => {
  await redis.quit();
};
