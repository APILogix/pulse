import promClient from 'prom-client';
import { register } from '../../../config/metrics.js';
import type { BillingJobName, BillingJobRunResult } from './types.js';

const billingJobProcessedTotal = new promClient.Counter({
  name: 'billing_job_processed_total',
  help: 'Total billing records processed by job.',
  labelNames: ['job'],
  registers: [register],
});

const billingJobFailedTotal = new promClient.Counter({
  name: 'billing_job_failed_total',
  help: 'Total billing records failed by job.',
  labelNames: ['job'],
  registers: [register],
});

const billingJobRetryTotal = new promClient.Counter({
  name: 'billing_job_retry_total',
  help: 'Total billing records retried by job.',
  labelNames: ['job'],
  registers: [register],
});

const billingJobDurationSeconds = new promClient.Histogram({
  name: 'billing_job_duration_seconds',
  help: 'Billing job run duration in seconds.',
  labelNames: ['job'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

const billingJobLastExecution = new promClient.Gauge({
  name: 'billing_job_last_execution_timestamp_seconds',
  help: 'Unix timestamp of the last billing job execution.',
  labelNames: ['job', 'status'],
  registers: [register],
});

const billingJobBatchCount = new promClient.Counter({
  name: 'billing_job_batches_total',
  help: 'Total billing job batches committed.',
  labelNames: ['job'],
  registers: [register],
});

export function observeBillingJob(result: BillingJobRunResult): void {
  const labels = { job: result.jobName };
  billingJobProcessedTotal.inc(labels, result.processed);
  billingJobFailedTotal.inc(labels, result.failed);
  billingJobRetryTotal.inc(labels, result.retried);
  billingJobBatchCount.inc(labels, result.batchCount);
  billingJobDurationSeconds.observe(labels, result.durationMs / 1000);
  billingJobLastExecution.set(
    { job: result.jobName, status: result.failed > 0 ? 'partial_failure' : 'success' },
    Math.floor(Date.now() / 1000),
  );
}

export function observeBillingJobFailure(jobName: BillingJobName): void {
  billingJobFailedTotal.inc({ job: jobName }, 1);
  billingJobLastExecution.set(
    { job: jobName, status: 'error' },
    Math.floor(Date.now() / 1000),
  );
}
