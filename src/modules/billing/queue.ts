/**
 * Billing PGMQ queue wiring.
 */
import type { FastifyBaseLogger } from 'fastify';
import { pgmq, type PgmqMessage } from '../../lib/pgmq.js';
import { PgmqWorker } from '../../lib/pgmq-worker.js';
import { billingJobDefinitions, loadBillingJobConfig } from './jobs/index.js';
import { observeBillingJob, observeBillingJobFailure } from './jobs/metrics.js';
import type { BillingJobConfig, BillingJobDefinition } from './jobs/types.js';

export function billingQueueName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

export async function registerBillingJobWorkers(
  logger: FastifyBaseLogger,
  config: BillingJobConfig = loadBillingJobConfig(),
): Promise<{ stop: () => Promise<void> }> {
  const log = logger.child({ component: 'billing-job-workers' });
  const abortController = new AbortController();
  const workers: PgmqWorker[] = [];

  const queueNames = billingJobDefinitions.map((d) => billingQueueName(d.name));
  await pgmq.createQueues(queueNames, { concurrency: 4 });

  for (const definition of billingJobDefinitions) {
    const queue = billingQueueName(definition.name);
    const worker = new PgmqWorker(
        pgmq,
        async () => {
          const jobLogger = logger.child({ billingJob: definition.name });
          const started = Date.now();
          jobLogger.info({ batchSize: config.batchSize }, 'Billing job started');
          try {
            const result = await definition.run({ config, logger: jobLogger, signal: abortController.signal });
            observeBillingJob(result);
            jobLogger.info(
              {
                processed: result.processed,
                failed: result.failed,
                retried: result.retried,
                batches: result.batchCount,
                durationMs: result.durationMs,
                stopped: result.stopped,
              },
              'Billing job finished',
            );
          } catch (error) {
            observeBillingJobFailure(definition.name);
            jobLogger.error({ error, durationMs: Date.now() - started }, 'Billing job failed');
            throw error;
          }
        },
        {
          queue,
          concurrency: config.concurrency,
          batchSize: 1,
          visibilityTimeoutSeconds: 300,
          maxAttempts: config.retryLimit,
        },
      );

      await worker.start();
      workers.push(worker);
  }

  // Periodic dispatch interval for billing jobs
  const interval = setInterval(() => {
    for (const def of billingJobDefinitions) {
      const q = billingQueueName(def.name);
      void pgmq.send(q, {}).catch(() => {});
    }
  }, 3600_000); // hourly tick
  interval.unref();

  log.info(
    {
      jobs: billingJobDefinitions.length,
      batchSize: config.batchSize,
      concurrency: config.concurrency,
    },
    'Billing PGMQ jobs registered',
  );

  return {
    stop: async () => {
      clearInterval(interval);
      abortController.abort();
      await Promise.all(workers.map((w) => w.stop()));
    },
  };
}
