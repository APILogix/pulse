/**
 * Summarize ingestion_admission_profile JSON logs into gateway/pg-boss enqueue evidence.
 */
import { readFile, writeFile } from 'fs/promises';

type OutputFormat = 'markdown' | 'json';

interface SummaryConfig {
  logsPath: string;
  format: OutputFormat;
  outPath: string | null;
}

interface QueueProfile {
  queue: string;
  jobs?: number;
  events?: number;
  bulk?: boolean;
  fallback?: boolean;
  durationMs?: number;
}

interface AdmissionProfile {
  phase?: string;
  eventType?: string;
  received?: number;
  accepted?: number;
  rejected?: number;
  shed?: number;
  jobsBuilt?: number;
  queueProvisionMs?: number;
  queueProvisionRetryMs?: number;
  enqueueMs?: number;
  totalAdmissionMs?: number;
  envelopeMs?: number;
  projectLookupMs?: number;
  normalizationMs?: number;
  authzMs?: number;
  rateLimitMs?: number;
  quotaMs?: number;
  queueDepthMs?: number;
  validationMs?: number;
  jobBuildMs?: number;
  usageAccountingMs?: number;
  enqueueQueues?: QueueProfile[];
}

interface Percentiles {
  count: number;
  min: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

interface QueueSummary extends Percentiles {
  queue: string;
  jobs: number;
  events: number;
  fallbackBatches: number;
}

interface AdmissionSummary {
  profiles: number;
  received: number;
  accepted: number;
  rejected: number;
  shed: number;
  jobsBuilt: number;
  enqueueMs: Percentiles;
  totalAdmissionMs: Percentiles;
  queueProvisionMs: Percentiles;
  queueProvisionRetryMs: Percentiles;
  admissionStages: Record<string, Percentiles>;
  profilesMissingQueueBreakdown: number;
  queues: QueueSummary[];
  diagnosticClassification: string[];
  findings: string[];
}

function usage(): void {
  console.error(`Usage:
  npm run ingestion:admission:summary -- --logs production.jsonl [--format markdown|json] [--out artifacts/ingestion-admission-summary.md]
`);
  process.exit(2);
}

function parseArgs(): SummaryConfig {
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

  const logsPath = args.logs;
  if (typeof logsPath !== 'string') usage();
  if (typeof logsPath !== 'string') process.exit(2);
  return {
    logsPath,
    format: args.format === 'json' ? 'json' : 'markdown',
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentile(sorted: number[], pct: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index] ?? null;
}

function percentiles(values: number[]): Percentiles {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? null,
  };
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function rounded(stats: Percentiles): Percentiles {
  return {
    count: stats.count,
    min: round(stats.min),
    p50: round(stats.p50),
    p95: round(stats.p95),
    p99: round(stats.p99),
    max: round(stats.max),
  };
}

function stagePercentiles(profiles: AdmissionProfile[], stages: string[]): Record<string, Percentiles> {
  const output: Record<string, Percentiles> = {};
  for (const stage of stages) {
    output[stage] = rounded(percentiles(profiles
      .map((profile) => finite((profile as unknown as Record<string, unknown>)[stage]))
      .filter((value): value is number => value !== null)));
  }
  return output;
}

async function readProfiles(path: string): Promise<AdmissionProfile[]> {
  const content = await readFile(path, 'utf8');
  const profiles: AdmissionProfile[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const row = object(parsed);
    if (row?.phase !== 'ingestion_admission_profile') continue;
    profiles.push(row as unknown as AdmissionProfile);
  }
  return profiles;
}

function summarize(profiles: AdmissionProfile[]): AdmissionSummary {
  const queueDurations = new Map<string, number[]>();
  const queueTotals = new Map<string, { jobs: number; events: number; fallbackBatches: number }>();

  for (const profile of profiles) {
    const queues = Array.isArray(profile.enqueueQueues) ? profile.enqueueQueues : [];
    for (const queue of queues) {
      if (typeof queue.queue !== 'string') continue;
      const durationMs = finite(queue.durationMs);
      if (durationMs !== null) {
        const durations = queueDurations.get(queue.queue) ?? [];
        durations.push(durationMs);
        queueDurations.set(queue.queue, durations);
      }
      const totals = queueTotals.get(queue.queue) ?? { jobs: 0, events: 0, fallbackBatches: 0 };
      totals.jobs += finite(queue.jobs) ?? 0;
      totals.events += finite(queue.events) ?? 0;
      if (queue.fallback === true) totals.fallbackBatches += 1;
      queueTotals.set(queue.queue, totals);
    }
  }

  const queues = [...queueTotals.entries()]
    .map(([queue, totals]) => ({
      queue,
      ...rounded(percentiles(queueDurations.get(queue) ?? [])),
      ...totals,
    }))
    .sort((a, b) => (b.p95 ?? -1) - (a.p95 ?? -1));

  const enqueueMs = rounded(percentiles(profiles.map((profile) => finite(profile.enqueueMs)).filter((value): value is number => value !== null)));
  const totalAdmissionMs = rounded(percentiles(profiles.map((profile) => finite(profile.totalAdmissionMs)).filter((value): value is number => value !== null)));
  const queueProvisionMs = rounded(percentiles(profiles.map((profile) => finite(profile.queueProvisionMs)).filter((value): value is number => value !== null)));
  const queueProvisionRetryMs = rounded(percentiles(profiles.map((profile) => finite(profile.queueProvisionRetryMs)).filter((value): value is number => value !== null)));
  const admissionStages = stagePercentiles(profiles, [
    'envelopeMs',
    'projectLookupMs',
    'normalizationMs',
    'authzMs',
    'rateLimitMs',
    'quotaMs',
    'queueDepthMs',
    'validationMs',
    'jobBuildMs',
    'enqueueMs',
    'usageAccountingMs',
    'totalAdmissionMs',
  ]);
  const profilesMissingQueueBreakdown = profiles.filter((profile) => {
    const queues = Array.isArray(profile.enqueueQueues) ? profile.enqueueQueues : [];
    return queues.length === 0 && (finite(profile.enqueueMs) ?? 0) > 0;
  }).length;

  const findings: string[] = [];
  const diagnosticClassification: string[] = [];
  const slowest = queues[0];
  const enqueueP95 = enqueueMs.p95 ?? 0;
  const slowQueues = queues.filter((queue) => (queue.p95 ?? 0) > 1000);
  if (profiles.length === 0) {
    diagnosticClassification.push('No admission profile rows were available to classify.');
  } else if (enqueueP95 > 1000 && profilesMissingQueueBreakdown > 0 && queues.length === 0) {
    diagnosticClassification.push(`Unlocalized primary pg-boss enqueue stall: enqueue p95 ${enqueueP95}ms, but ${profilesMissingQueueBreakdown} profile(s) omitted enqueueQueues.`);
    diagnosticClassification.push('Next proof required: capture ingestion_admission_profile logs from a build that emits enqueueQueues, then run ingestion:db:runtime during the same API enqueue window.');
  } else if (enqueueP95 > 1000 && slowQueues.length === 1) {
    diagnosticClassification.push(`Queue-specific primary pg-boss enqueue stall: ${slowQueues[0]!.queue} p95 ${slowQueues[0]!.p95}ms dominates aggregate enqueue p95 ${enqueueP95}ms.`);
    diagnosticClassification.push('Next proof required: compare that queue with primary pg-boss relation stats, locks, WAL sync, relation growth, and queue partition/notify audit evidence.');
  } else if (enqueueP95 > 1000 && slowQueues.length > 1) {
    diagnosticClassification.push(`Shared primary DB enqueue pressure: enqueue p95 ${enqueueP95}ms and ${slowQueues.length} queue(s) exceed 1000ms p95.`);
    diagnosticClassification.push('Next proof required: inspect primary pg-boss waiting sessions, lock waits, WAL sync per commit, cache hit rate, temp bytes, and pg-boss relation/index growth.');
  } else if (enqueueP95 > 1000) {
    diagnosticClassification.push(`Aggregate enqueue p95 ${enqueueP95}ms is high, but per-queue samples did not cross the queue threshold; inspect queue breakdown coverage and primary DB runtime evidence.`);
  } else {
    diagnosticClassification.push('Gateway enqueue latency did not cross the built-in slow threshold in these profiles.');
  }
  if (slowest && (slowest.p95 ?? 0) > 0) {
    findings.push(`Slowest enqueue queue by p95 was ${slowest.queue} at ${slowest.p95}ms across ${slowest.count} sample(s).`);
  }
  if (enqueueP95 > 1000 && queues.length === 0) {
    findings.push(`Gateway enqueue p95 was ${enqueueMs.p95}ms, but no enqueueQueues breakdown was present; capture logs from the build that emits per-queue enqueue details before claiming the pg-boss enqueue bottleneck is explained.`);
  }
  if (enqueueP95 > 1000 && slowest) {
    findings.push(`Gateway enqueue p95 was ${enqueueMs.p95}ms; compare per-queue timing with primary DB runtime pg-boss backlog, locks, and WAL/storage pressure.`);
  }
  const fallbackQueues = queues.filter((queue) => queue.fallbackBatches > 0);
  if (fallbackQueues.length > 0) {
    findings.push(`Fallback enqueue path was used by ${fallbackQueues.length} queue(s): ${fallbackQueues.map((queue) => queue.queue).join(', ')}.`);
  }
  if ((queueProvisionRetryMs.count ?? 0) > 0) {
    findings.push(`Queue provisioning retry occurred in ${queueProvisionRetryMs.count} profile(s); queue warmup was not complete before enqueue.`);
  }
  const slowAdmissionStages = Object.entries(admissionStages)
    .filter(([stage, stats]) => !['enqueueMs', 'totalAdmissionMs'].includes(stage) && (stats.p95 ?? 0) > 1000)
    .sort((a, b) => (b[1].p95 ?? 0) - (a[1].p95 ?? 0));
  if (slowAdmissionStages.length > 0) {
    findings.push(`Non-enqueue admission stage(s) above 1000ms p95: ${slowAdmissionStages.map(([stage, stats]) => `${stage}=${stats.p95}ms`).join(', ')}.`);
  }
  if (findings.length === 0) {
    findings.push('No queue-specific fallback or provisioning retry pressure was visible in the admission profiles.');
  }

  return {
    profiles: profiles.length,
    received: profiles.reduce((sum, profile) => sum + (finite(profile.received) ?? 0), 0),
    accepted: profiles.reduce((sum, profile) => sum + (finite(profile.accepted) ?? 0), 0),
    rejected: profiles.reduce((sum, profile) => sum + (finite(profile.rejected) ?? 0), 0),
    shed: profiles.reduce((sum, profile) => sum + (finite(profile.shed) ?? 0), 0),
    jobsBuilt: profiles.reduce((sum, profile) => sum + (finite(profile.jobsBuilt) ?? 0), 0),
    enqueueMs,
    totalAdmissionMs,
    queueProvisionMs,
    queueProvisionRetryMs,
    admissionStages,
    profilesMissingQueueBreakdown,
    queues,
    diagnosticClassification,
    findings,
  };
}

function renderNumber(value: number | null): string {
  return value === null ? '' : String(value);
}

function renderPercentileRow(label: string, stats: Percentiles): string {
  return `| ${label} | ${stats.count} | ${renderNumber(stats.min)} | ${renderNumber(stats.p50)} | ${renderNumber(stats.p95)} | ${renderNumber(stats.p99)} | ${renderNumber(stats.max)} |`;
}

function renderMarkdown(summary: AdmissionSummary): string {
  return [
    '# Ingestion Admission Profile Summary',
    '',
    `Profiles: ${summary.profiles}`,
    '',
    '## Totals',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Received | ${summary.received} |`,
    `| Accepted | ${summary.accepted} |`,
    `| Rejected | ${summary.rejected} |`,
    `| Shed | ${summary.shed} |`,
    `| Jobs built | ${summary.jobsBuilt} |`,
    '',
    '## Gateway Latency',
    '',
    '| Stage | Count | Min ms | p50 ms | p95 ms | p99 ms | Max ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    renderPercentileRow('enqueueMs', summary.enqueueMs),
    renderPercentileRow('totalAdmissionMs', summary.totalAdmissionMs),
    renderPercentileRow('queueProvisionMs', summary.queueProvisionMs),
    renderPercentileRow('queueProvisionRetryMs', summary.queueProvisionRetryMs),
    '',
    '## Admission Stage Detail',
    '',
    '| Stage | Count | Min ms | p50 ms | p95 ms | p99 ms | Max ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(summary.admissionStages).map(([stage, stats]) => renderPercentileRow(stage, stats)),
    '',
    '## Queue Breakdown Coverage',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Profiles missing enqueueQueues while enqueueMs > 0 | ${summary.profilesMissingQueueBreakdown} |`,
    '',
    '## Queue Enqueue Latency',
    '',
    '| Queue | Count | Jobs | Events | Fallback batches | Min ms | p50 ms | p95 ms | p99 ms | Max ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.queues.map((queue) => `| ${queue.queue} | ${queue.count} | ${queue.jobs} | ${queue.events} | ${queue.fallbackBatches} | ${renderNumber(queue.min)} | ${renderNumber(queue.p50)} | ${renderNumber(queue.p95)} | ${renderNumber(queue.p99)} | ${renderNumber(queue.max)} |`),
    '',
    '## Diagnostic Classification',
    '',
    ...summary.diagnosticClassification.map((classification) => `- ${classification}`),
    '',
    '## Findings',
    '',
    ...summary.findings.map((finding) => `- ${finding}`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const config = parseArgs();
  const profiles = await readProfiles(config.logsPath);
  const summary = summarize(profiles);
  const output = config.format === 'json'
    ? `${JSON.stringify(summary, null, 2)}\n`
    : renderMarkdown(summary);
  if (config.outPath) await writeFile(config.outPath, output, 'utf8');
  process.stdout.write(output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
