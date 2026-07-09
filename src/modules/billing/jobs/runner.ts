import type { BillingBatchResult, BillingJobConfig, BillingJobName, BillingJobRunResult } from './types.js';

export interface BillingBatchProcessor {
  processBatch: (batchSize: number) => Promise<BillingBatchResult>;
}

export async function runBatchedBillingJob(
  jobName: BillingJobName,
  config: BillingJobConfig,
  processor: BillingBatchProcessor,
  signal?: AbortSignal,
): Promise<BillingJobRunResult> {
  const started = Date.now();
  let processed = 0;
  let failed = 0;
  let retried = 0;
  let batchCount = 0;
  let stopped = false;

  for (let batch = 0; batch < config.maxBatchesPerRun; batch += 1) {
    if (signal?.aborted) {
      stopped = true;
      break;
    }

    const result = await processor.processBatch(config.batchSize);
    if (result.processed === 0 && result.failed === 0 && (result.retried ?? 0) === 0) {
      break;
    }

    processed += result.processed;
    failed += result.failed;
    retried += result.retried ?? 0;
    batchCount += 1;
  }

  return {
    jobName,
    processed,
    failed,
    retried,
    batchCount,
    durationMs: Date.now() - started,
    stopped,
  };
}
