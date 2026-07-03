import { pool } from '../../config/database.js';
import { pgboss } from '../../lib/pgboss.js';
import { runBillingCouponExpiryCleanup, runBillingDunningRetry, runBillingPlanLimitEnforcementSweep, runBillingSubscriptionRenewalReconciliation, runBillingTrialExpiryCheck, runBillingUsageDailyRollup, runBillingUsageLimitWarningSweep, } from './cleanup.js';
export const BILLING_JOBS = {
    trialExpiryCheck: 'billing.trial-expiry-check',
    trialExpiryWarningEmail: 'billing.trial-expiry-warning-email',
    usageLimitWarning: 'billing.usage-limit-warning',
    usageDailyRollup: 'billing.usage-daily-rollup',
    subscriptionRenewalReconciliation: 'billing.subscription-renewal-reconciliation',
    dunningRetry: 'billing.dunning-retry',
    couponExpiryCleanup: 'billing.coupon-expiry-cleanup',
    planLimitEnforcementSweep: 'billing.plan-limit-enforcement-sweep',
};
async function safeCreateQueue(name) {
    const boss = pgboss;
    if (typeof boss.createQueue === 'function') {
        await boss.createQueue(name).catch(() => undefined);
    }
}
export async function registerBillingWorkers(logger) {
    const log = logger.child({ component: 'billing-workers' });
    for (const name of Object.values(BILLING_JOBS)) {
        await safeCreateQueue(name);
    }
    await pgboss.work(BILLING_JOBS.trialExpiryCheck, {}, (async () => {
        await runBillingTrialExpiryCheck(pool, log);
    }));
    await pgboss.work(BILLING_JOBS.trialExpiryWarningEmail, {}, (async () => {
        log.info('billing trial expiry warning email sweep queued; email delivery integration not implemented yet');
    }));
    await pgboss.work(BILLING_JOBS.usageLimitWarning, {}, (async () => {
        await runBillingUsageLimitWarningSweep(pool, log);
    }));
    await pgboss.work(BILLING_JOBS.usageDailyRollup, {}, (async () => {
        await runBillingUsageDailyRollup(pool, log);
    }));
    await pgboss.work(BILLING_JOBS.subscriptionRenewalReconciliation, {}, (async () => {
        await runBillingSubscriptionRenewalReconciliation(pool, log);
    }));
    await pgboss.work(BILLING_JOBS.dunningRetry, {}, (async () => {
        await runBillingDunningRetry(pool, log);
    }));
    await pgboss.work(BILLING_JOBS.couponExpiryCleanup, {}, (async () => {
        await runBillingCouponExpiryCleanup(pool, log);
    }));
    await pgboss.work(BILLING_JOBS.planLimitEnforcementSweep, {}, (async () => {
        await runBillingPlanLimitEnforcementSweep(pool, log);
    }));
    await pgboss.schedule(BILLING_JOBS.trialExpiryCheck, '*/15 * * * *', {}, {});
    await pgboss.schedule(BILLING_JOBS.trialExpiryWarningEmail, '30 3 * * *', {}, {});
    await pgboss.schedule(BILLING_JOBS.usageLimitWarning, '0 * * * *', {}, {});
    await pgboss.schedule(BILLING_JOBS.usageDailyRollup, '15 0 * * *', {}, {});
    await pgboss.schedule(BILLING_JOBS.subscriptionRenewalReconciliation, '0 */6 * * *', {}, {});
    await pgboss.schedule(BILLING_JOBS.dunningRetry, '0 1 * * *', {}, {});
    await pgboss.schedule(BILLING_JOBS.couponExpiryCleanup, '30 1 * * *', {}, {});
    await pgboss.schedule(BILLING_JOBS.planLimitEnforcementSweep, '*/5 * * * *', {}, {});
    log.info('Billing cron registered');
    return {
        stop: async () => {
            for (const name of Object.values(BILLING_JOBS)) {
                await pgboss.unschedule(name).catch(() => undefined);
            }
        },
    };
}
//# sourceMappingURL=queue.js.map