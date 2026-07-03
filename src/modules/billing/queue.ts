import type { FastifyBaseLogger } from 'fastify';
import { pool } from '../../config/database.js';
import { pgboss } from '../../lib/pgboss.js';
import {
  runBillingCouponExpiryCleanup,
  runBillingDunningRetry,
  runBillingPlanLimitEnforcementSweep,
  runBillingSubscriptionRenewalReconciliation,
  runBillingTrialExpiryCheck,
  runBillingUsageDailyRollup,
  runBillingUsageLimitWarningSweep,
} from './cleanup.js';

export const BILLING_JOBS = {
  trialExpiryCheck: 'billing.trial-expiry-check',
  trialExpiryWarningEmail: 'billing.trial-expiry-warning-email',
  usageLimitWarning: 'billing.usage-limit-warning',
  usageDailyRollup: 'billing.usage-daily-rollup',
  subscriptionRenewalReconciliation: 'billing.subscription-renewal-reconciliation',
  dunningRetry: 'billing.dunning-retry',
  couponExpiryCleanup: 'billing.coupon-expiry-cleanup',
  planLimitEnforcementSweep: 'billing.plan-limit-enforcement-sweep',
} as const;

async function safeCreateQueue(name: string): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name).catch(() => undefined);
  }
}

export async function registerBillingWorkers(
  logger: FastifyBaseLogger,
): Promise<{ stop: () => Promise<void> }> {
  const log = logger.child({ component: 'billing-workers' });

  for (const name of Object.values(BILLING_JOBS)) {
    await safeCreateQueue(name);
  }

  await pgboss.work(
    BILLING_JOBS.trialExpiryCheck,
    {} as never,
    (async () => {
      await runBillingTrialExpiryCheck(pool, log);
    }) as never,
  );

  await pgboss.work(
    BILLING_JOBS.trialExpiryWarningEmail,
    {} as never,
    (async () => {
      log.info('billing trial expiry warning email sweep queued; email delivery integration not implemented yet');
    }) as never,
  );

  await pgboss.work(
    BILLING_JOBS.usageLimitWarning,
    {} as never,
    (async () => {
      await runBillingUsageLimitWarningSweep(pool, log);
    }) as never,
  );

  await pgboss.work(
    BILLING_JOBS.usageDailyRollup,
    {} as never,
    (async () => {
      await runBillingUsageDailyRollup(pool, log);
    }) as never,
  );

  await pgboss.work(
    BILLING_JOBS.subscriptionRenewalReconciliation,
    {} as never,
    (async () => {
      await runBillingSubscriptionRenewalReconciliation(pool, log);
    }) as never,
  );

  await pgboss.work(
    BILLING_JOBS.dunningRetry,
    {} as never,
    (async () => {
      await runBillingDunningRetry(pool, log);
    }) as never,
  );

  await pgboss.work(
    BILLING_JOBS.couponExpiryCleanup,
    {} as never,
    (async () => {
      await runBillingCouponExpiryCleanup(pool, log);
    }) as never,
  );

  await pgboss.work(
    BILLING_JOBS.planLimitEnforcementSweep,
    {} as never,
    (async () => {
      await runBillingPlanLimitEnforcementSweep(pool, log);
    }) as never,
  );

  await pgboss.schedule(BILLING_JOBS.trialExpiryCheck, '*/15 * * * *', {}, {} as never);
  await pgboss.schedule(BILLING_JOBS.trialExpiryWarningEmail, '30 3 * * *', {}, {} as never);
  await pgboss.schedule(BILLING_JOBS.usageLimitWarning, '0 * * * *', {}, {} as never);
  await pgboss.schedule(BILLING_JOBS.usageDailyRollup, '15 0 * * *', {}, {} as never);
  await pgboss.schedule(BILLING_JOBS.subscriptionRenewalReconciliation, '0 */6 * * *', {}, {} as never);
  await pgboss.schedule(BILLING_JOBS.dunningRetry, '0 1 * * *', {}, {} as never);
  await pgboss.schedule(BILLING_JOBS.couponExpiryCleanup, '30 1 * * *', {}, {} as never);
  await pgboss.schedule(BILLING_JOBS.planLimitEnforcementSweep, '*/5 * * * *', {}, {} as never);

  log.info('Billing cron registered');

  return {
    stop: async () => {
      for (const name of Object.values(BILLING_JOBS)) {
        await pgboss.unschedule(name).catch(() => undefined);
      }
    },
  };
}
