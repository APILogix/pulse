/**
 * Ingestion BullMQ worker.
 *
 * Flow:
 * 1. Consume one `EnrichedEvent` job from the `ingestion` queue.
 * 2. Check the Redis-backed circuit breaker before touching Postgres.
 * 3. Route the event to the correct PostgresWriter method by event type.
 * 4. Record success/failure in the circuit breaker state.
 * 5. Let BullMQ own retry and dead-letter behavior by rethrowing failures.
 *
 * This worker is the async half of the ingestion pipeline: the HTTP API accepts
 * and queues events quickly, while this process performs the durable database
 * writes.
 */
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PostgresWriter } from '../modules/ingestion/postgress.writter.js';
import { RedisCache } from '../db/redis/cache.js';
import { BillingRepository } from '../modules/billing/repository.js';
export declare function createIngestionWorker(connection: Redis, writer: PostgresWriter, cache: RedisCache, billingRepository: BillingRepository): Worker;
//# sourceMappingURL=ingestion.processor.d.ts.map