import type { FastifyBaseLogger } from 'fastify';
export declare const BILLING_JOB_NAMES: {
    readonly subscriptionRenewal: "billing.subscription-renewal";
    readonly trialExpiration: "billing.trial-expiration";
    readonly invoiceGeneration: "billing.invoice-generation";
    readonly paymentSync: "billing.payment-sync";
    readonly paymentReconciliation: "billing.payment-reconciliation";
    readonly webhookRetry: "billing.webhook-retry";
    readonly webhookDeadLetter: "billing.webhook-dead-letter";
    readonly usageRollover: "billing.usage-rollover";
    readonly usageAggregation: "billing.usage-aggregation";
    readonly aiCreditReset: "billing.ai-credit-reset";
    readonly couponExpiration: "billing.coupon-expiration";
    readonly addonExpiration: "billing.addon-expiration";
    readonly featureOverrideExpiration: "billing.feature-override-expiration";
    readonly invoiceReminder: "billing.invoice-reminder";
    readonly partitionCreator: "billing.partition-creator";
    readonly partitionCleanup: "billing.partition-cleanup";
    readonly usageAnomaly: "billing.usage-anomaly";
    readonly entitlementRefresh: "billing.entitlement-refresh";
    readonly billingAuditArchive: "billing.audit-archive";
    readonly dataReconciliation: "billing.data-reconciliation";
    readonly billingMetrics: "billing.metrics";
};
export type BillingJobKey = keyof typeof BILLING_JOB_NAMES;
export type BillingJobName = (typeof BILLING_JOB_NAMES)[BillingJobKey];
export interface BillingJobConfig {
    batchSize: number;
    maxBatchesPerRun: number;
    concurrency: number;
    retryLimit: number;
    retryDelaySeconds: number;
    retryBackoff: boolean;
    gracePeriodDays: number;
    retentionDays: number;
    archiveRetentionDays: number;
    webhookMaxRetries: number;
    invoiceReminderDays: readonly number[];
    anomalySpikeMultiplier: number;
    anomalyMinimumEvents: number;
    partitionMonthsAhead: number;
    schedules: Record<BillingJobKey, string>;
}
export interface BillingBatchResult {
    processed: number;
    failed: number;
    retried?: number;
}
export interface BillingJobRunResult {
    jobName: BillingJobName;
    processed: number;
    failed: number;
    retried: number;
    batchCount: number;
    durationMs: number;
    stopped: boolean;
}
export interface BillingJobContext {
    config: BillingJobConfig;
    logger: FastifyBaseLogger;
    signal?: AbortSignal;
}
export type BillingJobHandler = (context: BillingJobContext) => Promise<BillingJobRunResult>;
export interface BillingJobDefinition {
    key: BillingJobKey;
    name: BillingJobName;
    schedule: (config: BillingJobConfig) => string;
    run: BillingJobHandler;
}
//# sourceMappingURL=types.d.ts.map