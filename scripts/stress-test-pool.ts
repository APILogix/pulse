import { Pool } from 'pg';
import { env } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { PgQueue, PgQueueOptions } from '../src/modules/ingestion/queue/pg-queue.js';
import { PgQueueWorker } from '../src/modules/ingestion/queue/pg-queue-worker.js';

const log = logger.child({ script: 'stress-test' });

async function runStressTest() {
  log.info('Starting Enterprise Pool & Queue Stress Test...');

  // 1. Initialize a highly constrained pool to simulate connection pressure
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 15,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 30000,
    keepAlive: true,
  });

  pool.on('error', (err) => {
    log.error({ err }, 'Pool error occurred during stress test');
  });

  // 2. Initialize Queue
  const queue = new PgQueue(pool, { queue: 'stress_test_queue' });

  // Clear existing items in test queue
  await pool.query("DELETE FROM ingestion_jobs WHERE queue = 'stress_test_queue'");

  // 3. Enqueue thousands of jobs concurrently
  log.info('Enqueuing 2,000 jobs under heavy concurrency...');
  const enqueuePromises: Promise<any>[] = [];
  
  for (let i = 0; i < 20; i++) {
    const batch = Array.from({ length: 100 }, (_, j) => ({
      jobType: 'stress_event',
      payload: { index: i * 100 + j, timestamp: Date.now() },
    }));
    enqueuePromises.push(queue.enqueueBulk(batch).catch(e => log.error({ err: e }, 'Bulk enqueue failed')));
  }

  await Promise.all(enqueuePromises);
  log.info('Enqueue complete.');

  // 4. Start multiple aggressive workers
  let processedCount = 0;
  
  const handler = async (job: any) => {
    processedCount++;
    // Simulate DB work + CPU work to hold connection lock temporarily
    await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
  };

  const workers: PgQueueWorker[] = [];
  log.info('Starting 10 concurrent PgQueueWorkers...');
  for (let i = 0; i < 10; i++) {
    const worker = new PgQueueWorker(queue, handler, log, {
      workerId: `stress-worker-${i}`,
      batchSize: 50,
      busyPollMs: 10,  // Extremely aggressive polling
      idlePollMs: 100,
      handlerConcurrency: 5, // Bounded so 10 workers * 5 = 50 concurrent ops on 15 connections
    });
    worker.start();
    workers.push(worker);
  }

  // Monitor progress
  const interval = setInterval(async () => {
    log.info({ processed: processedCount }, 'Stress test progress');
    const depth = await queue.pendingDepth();
    log.info({ depth }, 'Pending depth');
    
    if (processedCount >= 2000) {
      clearInterval(interval);
      log.info('Stress test completed successfully without crashing!');
      
      // Stop all workers
      await Promise.all(workers.map(w => w.stop(5000)));
      await pool.end();
      process.exit(0);
    }
  }, 1000);

  // Hard timeout at 30 seconds
  setTimeout(() => {
    log.fatal({ processedCount }, 'Stress test failed to complete within 30 seconds!');
    process.exit(1);
  }, 30000);
}

runStressTest().catch(err => {
  log.fatal({ err }, 'Stress test failed catastrophically');
  process.exit(1);
});
