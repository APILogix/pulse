import type { BillingJobConfig, BillingJobKey } from './types.js';

const DEFAULT_SCHEDULES: Record<BillingJobKey, string> = {
  subscriptionRenewal: '*/5 * * * *',
  trialExpiration: '0 * * * *',
  invoiceGeneration: '*/10 * * * *',
  paymentSync: '*/15 * * * *',
  paymentReconciliation: '17 * * * *',
  webhookRetry: '*/2 * * * *',
  webhookDeadLetter: '*/15 * * * *',
  usageRollover: '10 0 1 * *',
  usageAggregation: '*/5 * * * *',
  aiCreditReset: '20 0 1 * *',
  couponExpiration: '*/30 * * * *',
  addonExpiration: '*/15 * * * *',
  featureOverrideExpiration: '*/15 * * * *',
  invoiceReminder: '0 9 * * *',
  partitionCreator: '0 1 25 * *',
  partitionCleanup: '30 1 * * *',
  usageAnomaly: '*/15 * * * *',
  entitlementRefresh: '*/10 * * * *',
  billingAuditArchive: '45 1 * * *',
  dataReconciliation: '5 2 * * *',
  billingMetrics: '*/5 * * * *',
};

function readInt(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function readFloat(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === 'true' || raw === '1';
}

function readSchedule(key: BillingJobKey, envName: string): string {
  return process.env[envName] ?? DEFAULT_SCHEDULES[key];
}

export function loadBillingJobConfig(): BillingJobConfig {
  return {
    batchSize: readInt('BILLING_JOB_BATCH_SIZE', 500, 1),
    maxBatchesPerRun: readInt('BILLING_JOB_MAX_BATCHES_PER_RUN', 200, 1),
    concurrency: readInt('BILLING_JOB_CONCURRENCY', 1, 1),
    retryLimit: readInt('BILLING_JOB_RETRY_LIMIT', 3, 0),
    retryDelaySeconds: readInt('BILLING_JOB_RETRY_DELAY_SECONDS', 60, 1),
    retryBackoff: readBool('BILLING_JOB_RETRY_BACKOFF', true),
    gracePeriodDays: readInt('BILLING_GRACE_PERIOD_DAYS', 3, 0),
    retentionDays: readInt('BILLING_RETENTION_DAYS', 365, 1),
    archiveRetentionDays: readInt('BILLING_AUDIT_ARCHIVE_RETENTION_DAYS', 2555, 1),
    webhookMaxRetries: readInt('BILLING_WEBHOOK_MAX_RETRIES', 12, 1),
    invoiceReminderDays: (process.env.BILLING_INVOICE_REMINDER_DAYS ?? '7,3,1,0')
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value) && value >= 0),
    anomalySpikeMultiplier: readFloat('BILLING_USAGE_ANOMALY_SPIKE_MULTIPLIER', 3, 1),
    anomalyMinimumEvents: readInt('BILLING_USAGE_ANOMALY_MIN_EVENTS', 1000, 1),
    partitionMonthsAhead: readInt('BILLING_PARTITION_MONTHS_AHEAD', 2, 1),
    schedules: {
      subscriptionRenewal: readSchedule('subscriptionRenewal', 'BILLING_SUBSCRIPTION_RENEWAL_CRON'),
      trialExpiration: readSchedule('trialExpiration', 'BILLING_TRIAL_EXPIRATION_CRON'),
      invoiceGeneration: readSchedule('invoiceGeneration', 'BILLING_INVOICE_GENERATION_CRON'),
      paymentSync: readSchedule('paymentSync', 'BILLING_PAYMENT_SYNC_CRON'),
      paymentReconciliation: readSchedule('paymentReconciliation', 'BILLING_PAYMENT_RECONCILIATION_CRON'),
      webhookRetry: readSchedule('webhookRetry', 'BILLING_WEBHOOK_RETRY_CRON'),
      webhookDeadLetter: readSchedule('webhookDeadLetter', 'BILLING_WEBHOOK_DEAD_LETTER_CRON'),
      usageRollover: readSchedule('usageRollover', 'BILLING_USAGE_ROLLOVER_CRON'),
      usageAggregation: readSchedule('usageAggregation', 'BILLING_USAGE_AGGREGATION_CRON'),
      aiCreditReset: readSchedule('aiCreditReset', 'BILLING_AI_CREDIT_RESET_CRON'),
      couponExpiration: readSchedule('couponExpiration', 'BILLING_COUPON_EXPIRATION_CRON'),
      addonExpiration: readSchedule('addonExpiration', 'BILLING_ADDON_EXPIRATION_CRON'),
      featureOverrideExpiration: readSchedule('featureOverrideExpiration', 'BILLING_FEATURE_OVERRIDE_EXPIRATION_CRON'),
      invoiceReminder: readSchedule('invoiceReminder', 'BILLING_INVOICE_REMINDER_CRON'),
      partitionCreator: readSchedule('partitionCreator', 'BILLING_PARTITION_CREATOR_CRON'),
      partitionCleanup: readSchedule('partitionCleanup', 'BILLING_PARTITION_CLEANUP_CRON'),
      usageAnomaly: readSchedule('usageAnomaly', 'BILLING_USAGE_ANOMALY_CRON'),
      entitlementRefresh: readSchedule('entitlementRefresh', 'BILLING_ENTITLEMENT_REFRESH_CRON'),
      billingAuditArchive: readSchedule('billingAuditArchive', 'BILLING_AUDIT_ARCHIVE_CRON'),
      dataReconciliation: readSchedule('dataReconciliation', 'BILLING_DATA_RECONCILIATION_CRON'),
      billingMetrics: readSchedule('billingMetrics', 'BILLING_METRICS_CRON'),
    },
  };
}
