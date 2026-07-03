import type { FastifyBaseLogger } from 'fastify';
export declare const BILLING_JOBS: {
    readonly trialExpiryCheck: "billing.trial-expiry-check";
    readonly trialExpiryWarningEmail: "billing.trial-expiry-warning-email";
    readonly usageLimitWarning: "billing.usage-limit-warning";
    readonly usageDailyRollup: "billing.usage-daily-rollup";
    readonly subscriptionRenewalReconciliation: "billing.subscription-renewal-reconciliation";
    readonly dunningRetry: "billing.dunning-retry";
    readonly couponExpiryCleanup: "billing.coupon-expiry-cleanup";
    readonly planLimitEnforcementSweep: "billing.plan-limit-enforcement-sweep";
};
export declare function registerBillingWorkers(logger: FastifyBaseLogger): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map