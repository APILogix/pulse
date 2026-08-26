/**
 * Verify a live ingestion worker /metrics scrape contains the metric families
 * required by the ingestion optimization evidence bundle.
 */
import { writeFile } from 'fs/promises';

interface ScrapeConfig {
  url: string;
  outPath: string | null;
  timeoutMs: number;
}

interface MetricCheck {
  metric: string;
  present: boolean;
}

interface SampleCheck {
  sample: string;
  present: boolean;
}

interface ScrapeProof {
  checkedAt: string;
  url: string;
  passed: boolean;
  status: number | null;
  bytes: number;
  checks: MetricCheck[];
  samples: SampleCheck[];
}

const requiredMetricFamilies = [
  'ingest_jobs_processed_total',
  'ingest_jobs_failed_total',
  'ingest_jobs_retried_total',
  'ingest_events_received_total',
  'ingest_events_inserted_total',
  'ingest_events_rejected_total',
  'ingest_events_deferred_total',
  'ingest_events_failed_total',
  'ingest_batches_processed_by_type_total',
  'ingest_events_inserted_by_type_total',
  'ingest_batch_bytes_total',
  'ingest_events_duplicate_total',
  'ingest_events_failed_by_reason_total',
  'ingest_fairness_deferred_jobs_total',
  'ingest_fairness_processed_jobs_total',
  'ingest_fairness_starvation_guard_admissions_total',
  'ingest_worker_inflight_jobs',
  'ingest_worker_configured_slots',
  'ingest_processing_latency_ms_quantile',
  'ingest_e2e_latency_ms_quantile',
  'ingest_stage_latency_ms_quantile',
  'ingest_db_query_duration_ms_quantile',
  'ingest_db_queries_per_batch_quantile',
  'ingest_events_per_batch_quantile',
  'ingest_batch_bytes_quantile',
  'ingest_queue_depth_ready',
  'ingest_queue_depth_deferred',
  'ingest_queue_depth_active',
  'ingest_queue_oldest_pending_job_age_ms',
  'ingest_dlq_retained_jobs',
  'ingest_db_pool_connections',
];

const requiredMetricSamples: Array<{ sample: string; pattern: RegExp }> = [
  {
    sample: 'ingest_stage_latency_ms_quantile{stage="perType.<eventType>.durationMs"}',
    pattern: /(^|\n)ingest_stage_latency_ms_quantile\{[^}]*stage="perType\.[^"]+\.durationMs"[^}]*}/,
  },
];

function usage(): void {
  console.error(`Usage:
  npm run ingestion:metrics:verify -- [--url http://localhost:9465/metrics] [--timeout-ms 5000] [--out artifacts/ingestion-metrics-scrape-proof.json]
`);
  process.exit(2);
}

function parseArgs(): ScrapeConfig {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = process.argv[i + 1];
    if (!value || value.startsWith('--')) args[key] = true;
    else {
      args[key] = value;
      i += 1;
    }
  }

  if (args.help === true || args.h === true) usage();
  const timeoutMs = Number(args['timeout-ms'] ?? 5000);
  return {
    url: typeof args.url === 'string' ? args.url : 'http://localhost:9465/metrics',
    outPath: typeof args.out === 'string' ? args.out : null,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
  };
}

function metricPresent(body: string, metric: string): boolean {
  const escaped = metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\n)(#\\s+(HELP|TYPE)\\s+${escaped}\\b|${escaped}(\\{|\\s))`).test(body);
}

async function scrape(config: ScrapeConfig): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.url, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'text/plain' },
    });
    return {
      status: response.status,
      body: await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const config = parseArgs();
  let status: number | null = null;
  let body = '';
  try {
    const result = await scrape(config);
    status = result.status;
    body = result.body;
  } catch (err) {
    const proof: ScrapeProof & { error: string } = {
      checkedAt: new Date().toISOString(),
      url: config.url,
      passed: false,
      status,
      bytes: 0,
      checks: requiredMetricFamilies.map((metric) => ({ metric, present: false })),
      samples: requiredMetricSamples.map(({ sample }) => ({ sample, present: false })),
      error: err instanceof Error ? err.message : String(err),
    };
    const json = `${JSON.stringify(proof, null, 2)}\n`;
    if (config.outPath) await writeFile(config.outPath, json, 'utf8');
    process.stdout.write(json);
    process.exit(1);
  }

  const checks = requiredMetricFamilies.map((metric) => ({
    metric,
    present: metricPresent(body, metric),
  }));
  const samples = requiredMetricSamples.map(({ sample, pattern }) => ({
    sample,
    present: pattern.test(body),
  }));
  const proof: ScrapeProof = {
    checkedAt: new Date().toISOString(),
    url: config.url,
    passed: status === 200
      && checks.every((check) => check.present)
      && samples.every((sample) => sample.present),
    status,
    bytes: Buffer.byteLength(body),
    checks,
    samples,
  };

  const json = `${JSON.stringify(proof, null, 2)}\n`;
  if (config.outPath) await writeFile(config.outPath, json, 'utf8');
  process.stdout.write(json);
  if (!proof.passed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
