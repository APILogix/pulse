import { BillingJobsRepository } from './repository.js';
import { runBatchedBillingJob } from './runner.js';
import { BILLING_JOB_NAMES, type BillingJobContext, type BillingJobName, type BillingJobRunResult } from './types.js';

export class BillingJobsService {
  constructor(private readonly repository: BillingJobsRepository) {}

  runSubscriptionRenewal(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.subscriptionRenewal, context, (batchSize) => this.repository.renewSubscriptions(batchSize));
  }

  runTrialExpiration(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.trialExpiration, context, (batchSize) => this.repository.expireTrials(batchSize));
  }

  runInvoiceGeneration(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.invoiceGeneration, context, (batchSize) => this.repository.generateInvoices(batchSize));
  }

  runPaymentSync(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.paymentSync, context, (batchSize) => this.repository.syncPayments(batchSize));
  }

  runPaymentReconciliation(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.paymentReconciliation, context, (batchSize) => this.repository.reconcilePayments(batchSize));
  }

  runWebhookRetry(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.webhookRetry, context, (batchSize) =>
      this.repository.retryWebhooks(batchSize, context.config.webhookMaxRetries),
    );
  }

  runWebhookDeadLetter(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.webhookDeadLetter, context, (batchSize) =>
      this.repository.deadLetterWebhooks(batchSize, context.config.webhookMaxRetries),
    );
  }

  runUsageRollover(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.usageRollover, context, (batchSize) => this.repository.rollOverUsage(batchSize));
  }

  runUsageAggregation(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.usageAggregation, context, (batchSize) => this.repository.aggregateUsage(batchSize));
  }

  runAiCreditReset(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.aiCreditReset, context, (batchSize) => this.repository.resetAiCredits(batchSize));
  }

  runCouponExpiration(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.couponExpiration, context, (batchSize) => this.repository.expireCoupons(batchSize));
  }

  runAddonExpiration(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.addonExpiration, context, (batchSize) => this.repository.expireAddons(batchSize));
  }

  runFeatureOverrideExpiration(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.featureOverrideExpiration, context, (batchSize) =>
      this.repository.expireFeatureOverrides(batchSize),
    );
  }

  runInvoiceReminder(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.invoiceReminder, context, (batchSize) =>
      this.repository.markInvoiceReminders(batchSize, context.config.invoiceReminderDays),
    );
  }

  async runPartitionCreator(context: BillingJobContext): Promise<BillingJobRunResult> {
    const started = Date.now();
    const result = await this.repository.createPartitions(context.config);
    return {
      jobName: BILLING_JOB_NAMES.partitionCreator,
      processed: result.processed,
      failed: result.failed,
      retried: result.retried ?? 0,
      batchCount: result.processed > 0 ? 1 : 0,
      durationMs: Date.now() - started,
      stopped: context.signal?.aborted ?? false,
    };
  }

  async runPartitionCleanup(context: BillingJobContext): Promise<BillingJobRunResult> {
    const started = Date.now();
    const result = await this.repository.cleanupPartitions(context.config.retentionDays);
    return {
      jobName: BILLING_JOB_NAMES.partitionCleanup,
      processed: result.processed,
      failed: result.failed,
      retried: result.retried ?? 0,
      batchCount: result.processed > 0 ? 1 : 0,
      durationMs: Date.now() - started,
      stopped: context.signal?.aborted ?? false,
    };
  }

  runUsageAnomaly(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.usageAnomaly, context, (batchSize) =>
      this.repository.detectUsageAnomalies(
        batchSize,
        context.config.anomalySpikeMultiplier,
        context.config.anomalyMinimumEvents,
      ),
    );
  }

  runEntitlementRefresh(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.entitlementRefresh, context, (batchSize) =>
      this.repository.refreshEntitlements(batchSize),
    );
  }

  async runBillingAuditArchive(context: BillingJobContext): Promise<BillingJobRunResult> {
    const started = Date.now();
    const result = await this.repository.archiveAuditLogs(context.config.archiveRetentionDays);
    return {
      jobName: BILLING_JOB_NAMES.billingAuditArchive,
      processed: result.processed,
      failed: result.failed,
      retried: result.retried ?? 0,
      batchCount: result.processed > 0 ? 1 : 0,
      durationMs: Date.now() - started,
      stopped: context.signal?.aborted ?? false,
    };
  }

  runDataReconciliation(context: BillingJobContext): Promise<BillingJobRunResult> {
    return this.run(BILLING_JOB_NAMES.dataReconciliation, context, (batchSize) => this.repository.reconcileData(batchSize));
  }

  async runBillingMetrics(context: BillingJobContext): Promise<BillingJobRunResult> {
    const started = Date.now();
    const result = await this.repository.publishMetrics();
    return {
      jobName: BILLING_JOB_NAMES.billingMetrics,
      processed: result.processed,
      failed: result.failed,
      retried: result.retried ?? 0,
      batchCount: 1,
      durationMs: Date.now() - started,
      stopped: context.signal?.aborted ?? false,
    };
  }

  private run(
    jobName: BillingJobName,
    context: BillingJobContext,
    processBatch: (batchSize: number) => Promise<{ processed: number; failed: number; retried?: number }>,
  ): Promise<BillingJobRunResult> {
    return runBatchedBillingJob(jobName, context.config, { processBatch }, context.signal);
  }
}
