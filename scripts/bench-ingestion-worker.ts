/**
 * Worker persistence benchmark for the ingestion pipeline.
 *
 * Default mode runs the TelemetryWriter path inside one transaction per batch
 * and rolls it back, which exercises insert SQL, indexes, triggers and outbox
 * writes without polluting the Log DB. Use --mode processor --commit to run the
 * full EventProcessor path, including error grouping and usage accounting.
 *
 * Examples:
 *   npm run bench:ingestion -- --type request --batches 50 --batch-size 200
 *   npm run bench:ingestion -- --type mixed --tenants 10 --batches 50 --batch-size 500
 *   npm run bench:ingestion -- --type error --mode processor --commit --batches 10 --batch-size 20
 *   npm run bench:ingestion -- --type error --batches 10 --batch-size 20 --out artifacts/error-bench.json
 */
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { performance } from 'perf_hooks';
import { Pool } from 'pg';
import type { Logger } from 'pino';
import { env } from '../src/config/env.js';
import { logDB } from '../src/config/log-database.js';
import { resolvePostgresSslConfig } from '../src/config/postgres-ssl.js';
import { EventProcessor, type EventProcessorResult } from '../src/modules/ingestion/workers/event-processor.js';
import { WorkerMetrics } from '../src/modules/ingestion/workers/metrics-server.js';
import { TelemetryWriter, type ScopedEvent } from '../src/modules/ingestion/pipeline/telemetry-writer.js';
import { INGEST_QUEUES, type IngestJobPayload, type PlanTier } from '../src/modules/ingestion/queue/ingest-queues.js';
import type { SdkEventType } from '../src/modules/ingestion/pipeline/event-normalizer.js';

type BenchMode = 'writer' | 'processor';
type BenchEventType = SdkEventType | 'mixed';
type TrafficProfile = 'low' | 'normal' | 'burst';

interface BenchConfig {
  mode: BenchMode;
  type: BenchEventType;
  batches: number;
  batchSize: number;
  warmupBatches: number;
  tenants: number;
  trafficProfile: TrafficProfile;
  interBatchDelayMs: number;
  commit: boolean;
  orgId: string;
  projectId: string;
  apiKeyId: string;
  apiKeyName: string;
  environment: string;
  planTier: PlanTier;
  outPath: string | null;
}

interface BatchResult {
  totalMs: number;
  inserted: number;
  stageMs: Record<string, number>;
  outboxInserted?: number;
}

type QuantileSummary = Record<string, number>;

interface ResourceSnapshot {
  wallMs: number;
  cpu: NodeJS.CpuUsage;
  memory: NodeJS.MemoryUsage;
}

interface PoolSnapshot {
  total: number;
  idle: number;
  waiting: number;
}

const eventTypes = new Set<SdkEventType>([
  'error',
  'message',
  'request',
  'span',
  'trace',
  'metric',
  'log',
  'profile',
  'cron_checkin',
  'replay',
]);
const mixedEventTypes = [...eventTypes];

const noopLogger = {
  child: () => noopLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
} as unknown as Logger;

function parseArgs(): BenchConfig {
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

  const type = String(args.type ?? 'request') as BenchEventType;
  if (type !== 'mixed' && !eventTypes.has(type)) throw new Error(`Unsupported --type ${type}`);
  const mode = String(args.mode ?? 'writer') as BenchMode;
  if (mode !== 'writer' && mode !== 'processor') throw new Error(`Unsupported --mode ${mode}`);
  const trafficProfile = parseTrafficProfile(args['traffic-profile'] ?? args.trafficProfile);
  const profileDelayMs = delayForTrafficProfile(trafficProfile);

  return {
    mode,
    type,
    batches: positiveInt(args.batches, 25),
    batchSize: positiveInt(args['batch-size'] ?? args.batchSize, 200),
    warmupBatches: positiveInt(args['warmup-batches'] ?? args.warmupBatches, 3),
    tenants: positiveInt(args.tenants ?? args.tenantCount, 1),
    trafficProfile,
    interBatchDelayMs: nonNegativeInt(args['inter-batch-delay-ms'] ?? args.interBatchDelayMs, profileDelayMs),
    commit: args.commit === true || args.commit === 'true',
    orgId: String(args.org ?? args.orgId ?? '11111111-1111-4111-8111-111111111111'),
    projectId: String(args.project ?? args.projectId ?? '22222222-2222-4222-8222-222222222222'),
    apiKeyId: String(args.apiKeyId ?? '33333333-3333-4333-8333-333333333333'),
    apiKeyName: String(args.apiKeyName ?? 'bench_ingestion_key'),
    environment: String(args.environment ?? 'benchmark'),
    planTier: String(args.planTier ?? 'enterprise') as PlanTier,
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

function parseTrafficProfile(value: unknown): TrafficProfile {
  if (value === undefined) return 'burst';
  if (value === 'low' || value === 'normal' || value === 'burst') return value;
  throw new Error(`Unsupported --traffic-profile ${String(value)}`);
}

function delayForTrafficProfile(profile: TrafficProfile): number {
  if (profile === 'low') return 50;
  if (profile === 'normal') return 5;
  return 0;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function nonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

function summarize(values: number[]): Record<string, number> {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: Math.round(sorted[0] ?? 0),
    avg: Math.round(sorted.length === 0 ? 0 : sum / sorted.length),
    p50: Math.round(percentile(sorted, 0.5)),
    p95: Math.round(percentile(sorted, 0.95)),
    p99: Math.round(percentile(sorted, 0.99)),
    p999: Math.round(percentile(sorted, 0.999)),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
  };
}

function parseMetricLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const [key, value] = part.split('=', 2);
    if (!key || !value) continue;
    labels[key.trim()] = value.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"');
  }
  return labels;
}

function quantileField(value: string | undefined): keyof QuantileSummary | null {
  switch (value) {
    case '0.5':
      return 'p50';
    case '0.95':
      return 'p95';
    case '0.99':
      return 'p99';
    case '0.999':
      return 'p999';
    default:
      return null;
  }
}

function setQuantileMax(target: Record<string, QuantileSummary>, key: string, quantile: keyof QuantileSummary, value: number): void {
  const summary = target[key] ?? {};
  summary[quantile] = Math.max(summary[quantile] ?? Number.NEGATIVE_INFINITY, value);
  target[key] = summary;
}

function workerMetricStages(metricsText: string | undefined): Record<string, QuantileSummary> {
  const stages: Record<string, QuantileSummary> = {};
  if (!metricsText) return stages;
  for (const line of metricsText.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i);
    if (!match) continue;
    const [, metric, rawLabels, rawValue] = match;
    const labels = parseMetricLabels(rawLabels ?? '');
    const quantile = quantileField(labels.quantile);
    const value = Number(rawValue);
    if (!quantile || !Number.isFinite(value)) continue;
    if (metric === 'ingest_stage_latency_ms_quantile' && labels.stage) {
      setQuantileMax(stages, labels.stage, quantile, value);
    } else if (metric === 'ingest_db_query_duration_ms_quantile') {
      setQuantileMax(stages, 'dbQueryMs', quantile, value);
    } else if (metric === 'ingest_processing_latency_ms_quantile') {
      setQuantileMax(stages, 'workerProcessingMs', quantile, value);
    } else if (metric === 'ingest_e2e_latency_ms_quantile') {
      setQuantileMax(stages, 'e2eMs', quantile, value);
    }
  }
  return stages;
}

function snapshotResources(): ResourceSnapshot {
  return {
    wallMs: performance.now(),
    cpu: process.cpuUsage(),
    memory: process.memoryUsage(),
  };
}

function summarizeResources(start: ResourceSnapshot, end: ResourceSnapshot, peakRssBytes: number, peakHeapUsedBytes: number): Record<string, number> {
  const cpu = process.cpuUsage(start.cpu);
  const wallMs = Math.max(0, end.wallMs - start.wallMs);
  const userMs = Math.round(cpu.user / 1000);
  const systemMs = Math.round(cpu.system / 1000);
  const totalMs = userMs + systemMs;
  return {
    wallMs: Math.round(wallMs),
    cpuUserMs: userMs,
    cpuSystemMs: systemMs,
    cpuTotalMs: totalMs,
    cpuUtilizationPct: wallMs === 0 ? 0 : Math.round((totalMs / wallMs) * 10_000) / 100,
    rssStartBytes: start.memory.rss,
    rssEndBytes: end.memory.rss,
    rssPeakBytes: peakRssBytes,
    heapUsedStartBytes: start.memory.heapUsed,
    heapUsedEndBytes: end.memory.heapUsed,
    heapUsedPeakBytes: peakHeapUsedBytes,
  };
}

function snapshotPool(pool: Pool): PoolSnapshot {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

function buildEvent(type: SdkEventType, index: number, runId: string): Record<string, unknown> {
  const timestamp = Date.now() - index;
  const eventId = `bench-${runId}-${type}-${index}`;
  const traceId = `trace-${runId}-${index}`;
  const spanId = `span-${runId}-${index}`;
  const base = { type, eventId, timestamp, traceId, spanId, service: 'ingestion-bench', release: 'bench' };

  switch (type) {
    case 'error':
      return { ...base, message: `benchmark error ${index}`, name: 'BenchmarkError', severity: 'error', stack: [] };
    case 'message':
      return { ...base, message: `benchmark message ${index}`, severity: 'info' };
    case 'request':
      return { ...base, requestId: `req-${runId}-${index}`, method: 'GET', url: '/bench', route: '/bench', statusCode: 200, latency: 12 };
    case 'span':
      return { ...base, name: 'bench-span', startTime: timestamp, endTime: timestamp + 12, duration: 12 };
    case 'trace':
      return {
        ...base,
        spanCount: 1,
        rootSpan: { id: spanId, name: 'bench-root', startTime: timestamp, endTime: timestamp + 12, duration: 12 },
      };
    case 'metric':
      return { ...base, metricName: 'bench.counter', metricType: 'counter', value: 1 };
    case 'log':
      return { ...base, level: 'info', message: `benchmark log ${index}` };
    case 'profile':
      return { ...base, profileType: 'cpu', startTime: timestamp, endTime: timestamp + 10, duration: 10, profile: { samples: [] } };
    case 'cron_checkin':
      return { ...base, monitorSlug: 'bench-monitor', status: 'ok', duration: 10, startedAt: timestamp, finishedAt: timestamp + 10 };
    case 'replay':
      return { ...base, sessionId: `session-${runId}`, segmentId: index, events: [] };
  }
}

function eventTypeFor(config: BenchConfig, index: number): SdkEventType {
  if (config.type !== 'mixed') return config.type;
  return mixedEventTypes[index % mixedEventTypes.length] as SdkEventType;
}

function tenantContext(config: BenchConfig, index: number): Pick<BenchConfig, 'orgId' | 'projectId' | 'apiKeyId' | 'apiKeyName'> {
  if (config.tenants <= 1) {
    return {
      orgId: config.orgId,
      projectId: config.projectId,
      apiKeyId: config.apiKeyId,
      apiKeyName: config.apiKeyName,
    };
  }

  const tenantNumber = (index % config.tenants) + 1;
  const suffix = String(tenantNumber).padStart(12, '0');
  return {
    orgId: `11111111-1111-4111-8111-${suffix}`,
    projectId: `22222222-2222-4222-8222-${suffix}`,
    apiKeyId: `33333333-3333-4333-8333-${suffix}`,
    apiKeyName: `${config.apiKeyName}_${tenantNumber}`,
  };
}

function scopedBatch(config: BenchConfig, batchNumber: number, runId: string): ScopedEvent[] {
  const offset = batchNumber * config.batchSize;
  return Array.from({ length: config.batchSize }, (_, i) => {
    const index = offset + i;
    const type = eventTypeFor(config, index);
    const tenant = tenantContext(config, index);
    return {
      orgId: tenant.orgId,
      projectId: tenant.projectId,
      orgSlug: 'bench-org',
      projectSlug: 'bench-project',
      apiKeyName: tenant.apiKeyName,
      environment: config.environment,
      event: buildEvent(type, index, runId) as ScopedEvent['event'],
    };
  });
}

function jobPayload(
  config: BenchConfig,
  type: SdkEventType,
  events: unknown[],
  batchNumber: number,
  runId: string,
  tenant: Pick<BenchConfig, 'orgId' | 'projectId' | 'apiKeyId' | 'apiKeyName'> = config,
): IngestJobPayload {
  return {
    organizationId: tenant.orgId,
    projectId: tenant.projectId,
    eventType: type,
    events,
    metadata: {
      batchId: `bench-${runId}-${batchNumber}`,
      apiKeyId: tenant.apiKeyId,
      apiKeyName: tenant.apiKeyName,
      planTier: config.planTier,
      receivedAt: new Date().toISOString(),
      environment: config.environment,
      deferCount: 0,
      orgSlug: 'bench-org',
      projectSlug: 'bench-project',
    },
  };
}

async function runWriterBatch(writer: TelemetryWriter, config: BenchConfig, batchNumber: number, runId: string): Promise<BatchResult> {
  const batch = scopedBatch(config, batchNumber, runId);
  const pool = logDB.getPrimaryPool();
  const totalStart = performance.now();
  const connectionStart = performance.now();
  const client = await pool.connect();
  const connectionWaitMs = performance.now() - connectionStart;
  try {
    await client.query('BEGIN');
    const insertStart = performance.now();
    const result = await writer.writeBatchDetailedWithOutbox(client, batch);
    const insertMs = performance.now() - insertStart;
    const finishStart = performance.now();
    await client.query(config.commit ? 'COMMIT' : 'ROLLBACK');
    const stageMs: Record<string, number> = {
      dbConnectionWaitMs: connectionWaitMs,
      insertMs,
      [config.commit ? 'commitMs' : 'rollbackMs']: performance.now() - finishStart,
    };
    for (const [type, stats] of Object.entries(result.perType)) {
      stageMs[`perType.${type}.durationMs`] = stats.durationMs;
    }
    return {
      totalMs: performance.now() - totalStart,
      inserted: result.totalInserted,
      outboxInserted: result.outboxInserted ?? 0,
      stageMs,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function runProcessorBatch(processor: EventProcessor, config: BenchConfig, batchNumber: number, runId: string): Promise<BatchResult> {
  const scoped = scopedBatch(config, batchNumber, runId);
  const totalStart = performance.now();
  const jobs = new Map<string, { type: SdkEventType; events: unknown[]; tenant: Pick<BenchConfig, 'orgId' | 'projectId' | 'apiKeyId' | 'apiKeyName'> }>();
  const offset = batchNumber * config.batchSize;
  for (const [i, row] of scoped.entries()) {
    const key = `${row.orgId}|${row.projectId}|${row.event.type}`;
    const existing = jobs.get(key);
    if (existing) {
      existing.events.push(row.event);
      continue;
    }
    jobs.set(key, {
      type: row.event.type,
      events: [row.event],
      tenant: {
        orgId: row.orgId ?? config.orgId,
        projectId: row.projectId,
        apiKeyId: tenantContext(config, offset + i).apiKeyId,
        apiKeyName: row.apiKeyName ?? config.apiKeyName,
      },
    });
  }
  let inserted = 0;
  let outboxInserted = 0;
  const stageMs: Record<string, number> = {};
  const addStages = (summary: EventProcessorResult): void => {
    for (const [stage, ms] of Object.entries(summary.timings)) {
      stageMs[stage] = (stageMs[stage] ?? 0) + ms;
    }
    for (const [type, stats] of Object.entries(summary.perType)) {
      stageMs[`perType.${type}.durationMs`] = (stageMs[`perType.${type}.durationMs`] ?? 0) + stats.durationMs;
    }
    if (summary.queueWaitMs != null) stageMs.queueWaitMs = (stageMs.queueWaitMs ?? 0) + summary.queueWaitMs;
  };
  for (const job of jobs.values()) {
    const summary = await processor.process(
      jobPayload(config, job.type, job.events, batchNumber, runId, job.tenant),
      INGEST_QUEUES[job.type],
    );
    inserted += summary.inserted;
    outboxInserted += summary.outboxInserted;
    addStages(summary);
  }
  return {
    totalMs: performance.now() - totalStart,
    inserted,
    outboxInserted,
    stageMs,
  };
}

async function main(): Promise<void> {
  const config = parseArgs();
  const runId = randomUUID().slice(0, 8);
  const writer = new TelemetryWriter(logDB.getPrimaryPool(), noopLogger);
  const metrics = new WorkerMetrics();
  let primaryPool: Pool | null = null;
  let processor: EventProcessor | null = null;
  const results: BatchResult[] = [];

  try {
    await logDB.connect();
    if (config.mode === 'processor') {
      primaryPool = new Pool({
        connectionString: env.DATABASE_URL,
        ssl: resolvePostgresSslConfig(env.DATABASE_URL, {
          enabled: env.DB_SSL_ENABLED,
          rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
        }),
        max: Math.max(1, Math.min(env.INGESTION_DB_POOL_SIZE, 4)),
        idleTimeoutMillis: env.INGESTION_DB_IDLE_TIMEOUT_MS,
        connectionTimeoutMillis: env.INGESTION_DB_CONNECTION_TIMEOUT_MS,
        application_name: `pulse_ingestion_bench_${env.NODE_ENV}`,
        keepAlive: true,
        keepAliveInitialDelayMillis: env.DB_KEEPALIVE_INITIAL_DELAY_MS,
      });
      await primaryPool.query('SELECT 1');
      processor = new EventProcessor(logDB.getPrimaryPool(), metrics, noopLogger, primaryPool);
    }

    const totalBatches = config.warmupBatches + config.batches;
    let resourceStart: ResourceSnapshot | null = null;
    let peakRssBytes = process.memoryUsage().rss;
    let peakHeapUsedBytes = process.memoryUsage().heapUsed;
    for (let batch = 0; batch < totalBatches; batch += 1) {
      if (batch === config.warmupBatches) {
        resourceStart = snapshotResources();
        peakRssBytes = resourceStart.memory.rss;
        peakHeapUsedBytes = resourceStart.memory.heapUsed;
      }
      const result = config.mode === 'processor'
        ? await runProcessorBatch(processor as EventProcessor, config, batch, runId)
        : await runWriterBatch(writer, config, batch, runId);
      if (batch >= config.warmupBatches) {
        results.push(result);
        const memory = process.memoryUsage();
        peakRssBytes = Math.max(peakRssBytes, memory.rss);
        peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
      }
      if (config.interBatchDelayMs > 0 && batch < totalBatches - 1) {
        await sleep(config.interBatchDelayMs);
      }
    }
    const resourceEnd = snapshotResources();

    const totalEvents = results.reduce((sum, row) => sum + row.inserted, 0);
    const totalOutboxInserted = results.reduce((sum, row) => sum + (row.outboxInserted ?? 0), 0);
    const totalMs = results.reduce((sum, row) => sum + row.totalMs, 0);
    const measuredWallMs = resourceStart ? resourceEnd.wallMs - resourceStart.wallMs : totalMs;
    const stageNames = new Set<string>();
    for (const row of results) {
      for (const key of Object.keys(row.stageMs)) stageNames.add(key);
    }
    const stages: Record<string, Record<string, number>> = {};
    for (const stage of stageNames) {
      stages[stage] = summarize(results.map((row) => row.stageMs[stage]).filter((ms): ms is number => typeof ms === 'number'));
    }
    const typeCounts: Record<string, number> = {};
    for (let batch = config.warmupBatches; batch < totalBatches; batch += 1) {
      const offset = batch * config.batchSize;
      for (let i = 0; i < config.batchSize; i += 1) {
        const type = eventTypeFor(config, offset + i);
        typeCounts[type] = (typeCounts[type] ?? 0) + 1;
      }
    }

    const workerMetrics = config.mode === 'processor' ? metrics.render(null) : undefined;
    const output = JSON.stringify({
      runId,
      mode: config.mode,
      type: config.type,
      tenants: config.tenants,
      trafficProfile: config.trafficProfile,
      interBatchDelayMs: config.interBatchDelayMs,
      committed: config.mode === 'processor' || config.commit,
      batches: config.batches,
      batchSize: config.batchSize,
      totalEvents,
      totalOutboxInserted,
      eventTypes: typeCounts,
      throughputEventsPerSec: Math.round((totalEvents / totalMs) * 100_000) / 100,
      wallThroughputEventsPerSec: measuredWallMs > 0
        ? Math.round((totalEvents / measuredWallMs) * 100_000) / 100
        : 0,
      totalLatencyMs: summarize(results.map((row) => row.totalMs)),
      stages: {
        ...stages,
        ...workerMetricStages(workerMetrics),
      },
      resources: resourceStart
        ? summarizeResources(resourceStart, resourceEnd, peakRssBytes, peakHeapUsedBytes)
        : undefined,
      dbPools: {
        log: snapshotPool(logDB.getPrimaryPool()),
        primary: primaryPool ? snapshotPool(primaryPool) : undefined,
      },
      workerMetrics,
    }, null, 2);
    if (config.outPath) {
      await mkdir(dirname(config.outPath), { recursive: true });
      await writeFile(config.outPath, `${output}\n`, 'utf8');
    }
    console.log(output);
  } finally {
    await processor?.stop().catch(() => undefined);
    await primaryPool?.end().catch(() => undefined);
    await logDB.close().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
