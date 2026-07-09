import { BillingJobsRepository } from './repository.js';
import { type BillingJobContext, type BillingJobRunResult } from './types.js';
export declare class BillingJobsService {
    private readonly repository;
    constructor(repository: BillingJobsRepository);
    runSubscriptionRenewal(context: BillingJobContext): Promise<BillingJobRunResult>;
    runTrialExpiration(context: BillingJobContext): Promise<BillingJobRunResult>;
    runInvoiceGeneration(context: BillingJobContext): Promise<BillingJobRunResult>;
    runPaymentSync(context: BillingJobContext): Promise<BillingJobRunResult>;
    runPaymentReconciliation(context: BillingJobContext): Promise<BillingJobRunResult>;
    runWebhookRetry(context: BillingJobContext): Promise<BillingJobRunResult>;
    runWebhookDeadLetter(context: BillingJobContext): Promise<BillingJobRunResult>;
    runUsageRollover(context: BillingJobContext): Promise<BillingJobRunResult>;
    runUsageAggregation(context: BillingJobContext): Promise<BillingJobRunResult>;
    runAiCreditReset(context: BillingJobContext): Promise<BillingJobRunResult>;
    runCouponExpiration(context: BillingJobContext): Promise<BillingJobRunResult>;
    runAddonExpiration(context: BillingJobContext): Promise<BillingJobRunResult>;
    runFeatureOverrideExpiration(context: BillingJobContext): Promise<BillingJobRunResult>;
    runInvoiceReminder(context: BillingJobContext): Promise<BillingJobRunResult>;
    runPartitionCreator(context: BillingJobContext): Promise<BillingJobRunResult>;
    runPartitionCleanup(context: BillingJobContext): Promise<BillingJobRunResult>;
    runUsageAnomaly(context: BillingJobContext): Promise<BillingJobRunResult>;
    runEntitlementRefresh(context: BillingJobContext): Promise<BillingJobRunResult>;
    runBillingAuditArchive(context: BillingJobContext): Promise<BillingJobRunResult>;
    runDataReconciliation(context: BillingJobContext): Promise<BillingJobRunResult>;
    runBillingMetrics(context: BillingJobContext): Promise<BillingJobRunResult>;
    private run;
}
//# sourceMappingURL=service.d.ts.map