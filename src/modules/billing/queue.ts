/**
 * Billing pg-boss queue wiring.
 *
 * Schedules are stored in Postgres and delivered to one worker, so the billing
 * jobs are safe across horizontally scaled worker and cron processes.
 */
import type { FastifyBaseLogger } from 'fastify';

import { pgboss } from '../../lib/pgboss.js';
import { billingJobDefinitions, loadBillingJobConfig } from './jobs/index.js';
import { observeBillingJob, observeBillingJobFailure } from './jobs/metrics.js';
import type { BillingJobConfig, BillingJobDefinition } from './jobs/types.js';

async function safeCreateQueue(name: string): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name).catch(() => undefined);
  }
}

async function registerJobWorker(
  definition: BillingJobDefinition,
  config: BillingJobConfig,
  logger: FastifyBaseLogger,
  abortSignal: AbortSignal,
): Promise<void> {
  await safeCreateQueue(definition.name);

  await pgboss.work(
    definition.name,
    { teamSize: config.concurrency, teamConcurrency: config.concurrency } as never,
    (async () => {
      const jobLogger = logger.child({ billingJob: definition.name });
      const started = Date.now();
      jobLogger.info({ batchSize: config.batchSize }, 'Billing job started');
      try {
        const result = await definition.run({ config, logger: jobLogger, signal: abortSignal });
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
    }) as never,
  );

  await pgboss.schedule(
    definition.name,
    definition.schedule(config),
    {},
    {
      retryLimit: config.retryLimit,
      retryDelay: config.retryDelaySeconds,
      retryBackoff: config.retryBackoff,
    } as never,
  );
}

export async function registerBillingJobWorkers(
  logger: FastifyBaseLogger,
  config: BillingJobConfig = loadBillingJobConfig(),
): Promise<{ stop: () => Promise<void> }> {
  const log = logger.child({ component: 'billing-job-workers' });
  const abortController = new AbortController();

  for (const definition of billingJobDefinitions) {
    await registerJobWorker(definition, config, log, abortController.signal);
  }

  log.info(
    {
      jobs: billingJobDefinitions.length,
      batchSize: config.batchSize,
      concurrency: config.concurrency,
    },
    'Billing jobs registered',
  );

  return {
    stop: async () => {
      abortController.abort();
      await Promise.all(
        billingJobDefinitions.map((definition) =>
          pgboss.unschedule(definition.name).catch(() => undefined),
        ),
      );
    },
  };
}
