import type { FastifyBaseLogger } from 'fastify';

export const BILLING_JOB_NAMES = {
  subscriptionRenewal: 'billing.subscription-renewal',
  trialExpiration: 'billing.trial-expiration',
  invoiceGeneration: 'billing.invoice-generation',
  paymentSync: 'billing.payment-sync',
  paymentReconciliation: 'billing.payment-reconciliation',
  webhookRetry: 'billing.webhook-retry',
  webhookDeadLetter: 'billing.webhook-dead-letter',
  usageRollover: 'billing.usage-rollover',
  usageAggregation: 'billing.usage-aggregation',
  aiCreditReset: 'billing.ai-credit-reset',
  couponExpiration: 'billing.coupon-expiration',
  addonExpiration: 'billing.addon-expiration',
  featureOverrideExpiration: 'billing.feature-override-expiration',
  invoiceReminder: 'billing.invoice-reminder',
  partitionCreator: 'billing.partition-creator',
  partitionCleanup: 'billing.partition-cleanup',
  usageAnomaly: 'billing.usage-anomaly',
  entitlementRefresh: 'billing.entitlement-refresh',
  billingAuditArchive: 'billing.audit-archive',
  dataReconciliation: 'billing.data-reconciliation',
  billingMetrics: 'billing.metrics',
} as const;

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
