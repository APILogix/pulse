/**
 * Worker registry and lifecycle wiring.
 *
 * Flow:
 * 1. Receive already-constructed infrastructure dependencies from a bootstrap
 *    entrypoint.
 * 2. Create the ingestion worker, which is the only active worker today.
 * 3. Keep future worker registration centralized here so one process can own
 *    multiple BullMQ workers.
 * 4. Handle SIGTERM/SIGINT by closing workers first, then optional external
 *    infrastructure such as Redis and Postgres.
 */
import { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { PostgresWriter } from '../modules/ingestion/postgress.writter.js';
import type { RedisCache } from '../db/redis/cache.js';
import { BillingRepository } from '../modules/billing/repository.js';
export interface WorkerDependencies {
    writer: PostgresWriter;
    cache: RedisCache;
    pgPool: Pool;
    billingRepository: BillingRepository;
    shutdown?: () => Promise<void>;
}
export declare function initializeWorkers(redis: Redis, deps: WorkerDependencies): {
    ingestionWorker: import("bullmq").Worker<any, any, string>;
};
//# sourceMappingURL=index.d.ts.map