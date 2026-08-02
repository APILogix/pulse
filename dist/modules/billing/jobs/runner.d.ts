import type { BillingBatchResult, BillingJobConfig, BillingJobName, BillingJobRunResult } from './types.js';
export interface BillingBatchProcessor {
    processBatch: (batchSize: number) => Promise<BillingBatchResult>;
}
export declare function runBatchedBillingJob(jobName: BillingJobName, config: BillingJobConfig, processor: BillingBatchProcessor, signal?: AbortSignal): Promise<BillingJobRunResult>;
//# sourceMappingURL=runner.d.ts.map