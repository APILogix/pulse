import type { Pool, PoolClient } from 'pg';
import type { BillingBatchResult, BillingJobConfig } from './types.js';
type TxWork<T> = (client: PoolClient) => Promise<T>;
export declare class BillingJobsRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(work: TxWork<T>): Promise<T>;
    renewSubscriptions(batchSize: number): Promise<BillingBatchResult>;
    expireTrials(batchSize: number): Promise<BillingBatchResult>;
    generateInvoices(batchSize: number): Promise<BillingBatchResult>;
    syncPayments(batchSize: number): Promise<BillingBatchResult>;
    reconcilePayments(batchSize: number): Promise<BillingBatchResult>;
    retryWebhooks(batchSize: number, maxRetries: number): Promise<BillingBatchResult>;
    deadLetterWebhooks(batchSize: number, maxRetries: number): Promise<BillingBatchResult>;
    rollOverUsage(batchSize: number): Promise<BillingBatchResult>;
    aggregateUsage(batchSize: number): Promise<BillingBatchResult>;
    resetAiCredits(batchSize: number): Promise<BillingBatchResult>;
    expireCoupons(batchSize: number): Promise<BillingBatchResult>;
    expireAddons(batchSize: number): Promise<BillingBatchResult>;
    expireFeatureOverrides(batchSize: number): Promise<BillingBatchResult>;
    markInvoiceReminders(batchSize: number, days: readonly number[]): Promise<BillingBatchResult>;
    createPartitions(config: BillingJobConfig): Promise<BillingBatchResult>;
    cleanupPartitions(retentionDays: number): Promise<BillingBatchResult>;
    detectUsageAnomalies(batchSize: number, multiplier: number, minimumEvents: number): Promise<BillingBatchResult>;
    refreshEntitlements(batchSize: number): Promise<BillingBatchResult>;
    archiveAuditLogs(retentionDays: number): Promise<BillingBatchResult>;
    reconcileData(batchSize: number): Promise<BillingBatchResult>;
    publishMetrics(): Promise<BillingBatchResult>;
    private updateWithAudit;
}
export {};
//# sourceMappingURL=repository.d.ts.map