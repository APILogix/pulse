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
import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { PostgresWriter } from '../modules/ingestion/postgress.writter.js';
import { RedisCache } from '../db/redis/cache.js';
export function createIngestionWorker(connection, writer, cache) {
    // One BullMQ worker instance can process many jobs concurrently; concurrency
    // and limiter settings should stay aligned with Postgres pool capacity.
    const worker = new Worker('ingestion', async (job) => {
        const event = job.data;
        // Skip work while the database circuit is open so retries back off instead
        // of amplifying an outage.
        if (await cache.isCircuitOpen('database')) {
            throw new Error('CIRCUIT_OPEN');
        }
        try {
            // Persist the canonical event row plus type-specific child rows where
            // applicable. Request and error events need specialized tables.
            switch (event.type) {
                case 'request': {
                    await writer.writeRequestEvents([event]);
                    break;
                }
                case 'error': {
                    await writer.writeErrorEvents([event]);
                    break;
                }
                case 'log':
                case 'metric':
                case 'custom': {
                    await writer.writeEvents([event]);
                    break;
                }
                default: {
                    await writer.writeEvents([event]);
                }
            }
            // Record success so a recovering dependency can close the circuit again.
            await cache.recordSuccess('database');
        }
        catch (err) {
            // Record failure and rethrow so BullMQ retries according to queue policy.
            await cache.recordFailure('database', 10);
            throw err; // Let BullMQ handle retry/DLQ
        }
    }, {
        connection,
        // Tune concurrency against the available Postgres connections and write
        // cost per event type.
        concurrency: 20,
        limiter: {
            max: 100,
            duration: 1000,
        },
        stalledInterval: 30000,
    });
    worker.on('completed', (job) => {
        console.log(`[Worker] Job ${job.id} completed (${job.data.type})`);
    });
    worker.on('failed', (job, err) => {
        console.error(`[Worker] Job ${job?.id} failed:`, err.message);
        // Alerting integration here (PagerDuty, Slack, etc.)
    });
    worker.on('stalled', (jobId) => {
        console.warn(`[Worker] Job ${jobId} stalled`);
    });
    return worker;
}
//# sourceMappingURL=ingestion.processor.js.map