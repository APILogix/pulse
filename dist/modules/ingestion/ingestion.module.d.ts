import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { RedisCache } from '../../db/redis/cache.js';
import { PostgresWriter } from './postgress.writter.js';
declare module 'fastify' {
    interface FastifyInstance {
        ingestionQueue: Queue;
        redisCache: RedisCache;
        postgresWriter: PostgresWriter;
    }
}
export declare const ingestionModule: (fastify: FastifyInstance) => Promise<void>;
//# sourceMappingURL=ingestion.module.d.ts.map