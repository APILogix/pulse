import { BillingJobsRepository } from './repository.js';
import { runBatchedBillingJob } from './runner.js';
import { BILLING_JOB_NAMES } from './types.js';
export class BillingJobsService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    runSubscriptionRenewal(context) {
        return this.run(BILLING_JOB_NAMES.subscriptionRenewal, context, (batchSize) => this.repository.renewSubscriptions(batchSize));
    }
    runTrialExpiration(context) {
        return this.run(BILLING_JOB_NAMES.trialExpiration, context, (batchSize) => this.repository.expireTrials(batchSize));
    }
    runInvoiceGeneration(context) {
        return this.run(BILLING_JOB_NAMES.invoiceGeneration, context, (batchSize) => this.repository.generateInvoices(batchSize));
    }
    runPaymentSync(context) {
        return this.run(BILLING_JOB_NAMES.paymentSync, context, (batchSize) => this.repository.syncPayments(batchSize));
    }
    runPaymentReconciliation(context) {
        return this.run(BILLING_JOB_NAMES.paymentReconciliation, context, (batchSize) => this.repository.reconcilePayments(batchSize));
    }
    runWebhookRetry(context) {
        return this.run(BILLING_JOB_NAMES.webhookRetry, context, (batchSize) => this.repository.retryWebhooks(batchSize, context.config.webhookMaxRetries));
    }
    runWebhookDeadLetter(context) {
        return this.run(BILLING_JOB_NAMES.webhookDeadLetter, context, (batchSize) => this.repository.deadLetterWebhooks(batchSize, context.config.webhookMaxRetries));
    }
    runUsageRollover(context) {
        return this.run(BILLING_JOB_NAMES.usageRollover, context, (batchSize) => this.repository.rollOverUsage(batchSize));
    }
    runUsageAggregation(context) {
        return this.run(BILLING_JOB_NAMES.usageAggregation, context, (batchSize) => this.repository.aggregateUsage(batchSize));
    }
    runAiCreditReset(context) {
        return this.run(BILLING_JOB_NAMES.aiCreditReset, context, (batchSize) => this.repository.resetAiCredits(batchSize));
    }
    runCouponExpiration(context) {
        return this.run(BILLING_JOB_NAMES.couponExpiration, context, (batchSize) => this.repository.expireCoupons(batchSize));
    }
    runAddonExpiration(context) {
        return this.run(BILLING_JOB_NAMES.addonExpiration, context, (batchSize) => this.repository.expireAddons(batchSize));
    }
    runFeatureOverrideExpiration(context) {
        return this.run(BILLING_JOB_NAMES.featureOverrideExpiration, context, (batchSize) => this.repository.expireFeatureOverrides(batchSize));
    }
    runInvoiceReminder(context) {
        return this.run(BILLING_JOB_NAMES.invoiceReminder, context, (batchSize) => this.repository.markInvoiceReminders(batchSize, context.config.invoiceReminderDays));
    }
    async runPartitionCreator(context) {
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
    async runPartitionCleanup(context) {
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
    runUsageAnomaly(context) {
        return this.run(BILLING_JOB_NAMES.usageAnomaly, context, (batchSize) => this.repository.detectUsageAnomalies(batchSize, context.config.anomalySpikeMultiplier, context.config.anomalyMinimumEvents));
    }
    runEntitlementRefresh(context) {
        return this.run(BILLING_JOB_NAMES.entitlementRefresh, context, (batchSize) => this.repository.refreshEntitlements(batchSize));
    }
    async runBillingAuditArchive(context) {
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
    runDataReconciliation(context) {
        return this.run(BILLING_JOB_NAMES.dataReconciliation, context, (batchSize) => this.repository.reconcileData(batchSize));
    }
    async runBillingMetrics(context) {
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
    run(jobName, context, processBatch) {
        return runBatchedBillingJob(jobName, context.config, { processBatch }, context.signal);
    }
}
//# sourceMappingURL=service.js.map