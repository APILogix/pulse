import { afterEach, describe, expect, it } from 'vitest';

import { loadBillingJobConfig } from '../../src/modules/billing/jobs/config.js';
import { runBatchedBillingJob } from '../../src/modules/billing/jobs/runner.js';
import { BILLING_JOB_NAMES } from '../../src/modules/billing/jobs/types.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('billing job configuration', () => {
  it('loads env-backed batching, retry, and schedule values', () => {
    process.env.BILLING_JOB_BATCH_SIZE = '250';
    process.env.BILLING_JOB_MAX_BATCHES_PER_RUN = '4';
    process.env.BILLING_WEBHOOK_MAX_RETRIES = '9';
    process.env.BILLING_SUBSCRIPTION_RENEWAL_CRON = '*/7 * * * *';

    const config = loadBillingJobConfig();

    expect(config.batchSize).toBe(250);
    expect(config.maxBatchesPerRun).toBe(4);
    expect(config.webhookMaxRetries).toBe(9);
    expect(config.schedules.subscriptionRenewal).toBe('*/7 * * * *');
  });

  it('exposes every required billing job name', () => {
    expect(Object.values(BILLING_JOB_NAMES).sort()).toEqual([
      'billing.addon-expiration',
      'billing.ai-credit-reset',
      'billing.audit-archive',
      'billing.coupon-expiration',
      'billing.data-reconciliation',
      'billing.entitlement-refresh',
      'billing.feature-override-expiration',
      'billing.invoice-generation',
      'billing.invoice-reminder',
      'billing.metrics',
      'billing.partition-cleanup',
      'billing.partition-creator',
      'billing.payment-reconciliation',
      'billing.payment-sync',
      'billing.subscription-renewal',
      'billing.trial-expiration',
      'billing.usage-aggregation',
      'billing.usage-anomaly',
      'billing.usage-rollover',
      'billing.webhook-dead-letter',
      'billing.webhook-retry',
    ].sort());
  });
});

describe('billing job runner', () => {
  it('processes batches until the repository reports no work', async () => {
    const batches = [500, 125, 0];
    const result = await runBatchedBillingJob(
      BILLING_JOB_NAMES.usageAggregation,
      {
        ...loadBillingJobConfig(),
        batchSize: 500,
        maxBatchesPerRun: 10,
      },
      {
        processBatch: async () => ({
          processed: batches.shift() ?? 0,
          failed: 0,
          retried: 0,
        }),
      },
    );

    expect(result.processed).toBe(625);
    expect(result.batchCount).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('respects maxBatchesPerRun to keep transactions bounded', async () => {
    const result = await runBatchedBillingJob(
      BILLING_JOB_NAMES.webhookRetry,
      {
        ...loadBillingJobConfig(),
        batchSize: 500,
        maxBatchesPerRun: 2,
      },
      {
        processBatch: async () => ({
          processed: 500,
          failed: 0,
          retried: 500,
        }),
      },
    );

    expect(result.processed).toBe(1000);
    expect(result.retried).toBe(1000);
    expect(result.batchCount).toBe(2);
  });
});
