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
 *
 * ── Phase 2 additions (design §Component map, §7) ──────────────────────────
 *
 * Everything below is **additive**. Every pre-existing CLI flag keeps its
 * meaning and every pre-existing output field keeps its name, shape and value,
 * because `scripts/run-ingestion-benchmark-matrix.ts` and
 * `scripts/validate-ingestion-evidence-bundle.ts` read them. The new material
 * lives under one top-level `phase2` key so it cannot collide with a field an
 * existing consumer already parses.
 *
 *   - **Time-boxed windows and repetitions** (Requirement 1.7, 11.1, 17.1).
 *     `--warmup-seconds`, `--duration-seconds`, `--repetitions` and
 *     `--sustained` replace the batch-count loop with a warm-up window followed
 *     by a measurement window, repeated N times. The warm-up window is
 *     discarded from every reported value: nothing observed inside it enters a
 *     repetition record, an aggregate or the legacy top-level fields.
 *
 *   - **WAL bytes per batch transaction** (Requirement 10.1, 16.1, design §7.1).
 *     `--wal` samples `pg_current_wal_lsn()` on a **separate** connection
 *     immediately before the transaction starts and again after it commits, and
 *     differences the pair with `pg_wal_lsn_diff()`. That measure is
 *     cluster-wide, so `walAttribution` is resolved from a `pg_stat_activity`
 *     count of non-idle client backends that do not belong to this harness:
 *     `exclusive_cluster` when none were observed, `shared_cluster` otherwise.
 *     A `shared_cluster` figure is marked an **upper bound** rather than
 *     reported as exact, because another backend's WAL lands in the same LSN
 *     range and cannot be subtracted out after the fact.
 *
 *   - **Per-Signal_Type offered-rate mix and per-organization offered shares**
 *     (Requirement 13.1, 13.2, 14.3). `--signal-mix` and `--org-shares` take
 *     weight specifications and allocate offered events by the largest-remainder
 *     method, so the realized composition is deterministic and reproducible
 *     rather than a random draw that only converges in the limit. Per-org
 *     figures are emitted as **benchmark-only** labels inside this harness's own
 *     JSON; no per-org label is added to the production metric registry, whose
 *     cardinality must stay bounded by queue and type.
 *
 *   - **Statement counting** (Requirement 21.3). `countStatements()` from
 *     `scripts/lib/statement-counter.ts` is installed on every Log DB client the
 *     run acquires, so both client round trips and the top-level server
 *     statements they carried are recorded per batch. The counter is restored on
 *     release, so a pooled client is never left wrapped.
 *
 *   - **`Measured<T>` for every reported aggregate** (Requirement 17.2, 17.4).
 *     Aggregates come from `summarize()` over the repetitions that
 *     `filterValidRepetitions()` admits, so a repetition that terminated early
 *     (Requirement 17.8) or whose error rate exceeded 1 % (Requirement 17.9)
 *     is recorded with its reason and excluded from every reported number. A
 *     metric with no valid repetition records the byte-exact
 *     Unmeasured_Declaration plus a reason — never a zero.
 *
 *   - **Process CPU, peak RSS and `ingestion-workers` restarts** per run
 *     (Requirement 15.6). Restarts are read from `pm2 jlist`, not inferred from
 *     the heap figure, because `ecosystem.config.cjs` sets
 *     `max_memory_restart: '700M'` above the 512 MB heap limit and RSS can
 *     therefore trip a restart the heap number never predicts. When pm2 is not
 *     reachable the count is recorded unmeasured with the reason rather than
 *     reported as 0, which would be a fabricated measurement.
 *
 * Phase 2 examples:
 *   npm run bench:ingestion -- --mode processor --commit --sustained \
 *     --warmup-seconds 30 --duration-seconds 60 --repetitions 3 --wal
 *   npm run bench:ingestion -- --mode processor --commit --sustained \
 *     --signal-mix trace=30,span=30,request=15,error=15,log=10
 *   npm run bench:ingestion -- --mode processor --commit --sustained \
 *     --org-shares flood=90,small1=4,small2=3,small3=2,small4=1
 */
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { performance } from 'perf_hooks';
import { Pool, type PoolClient } from 'pg';
import type { Logger } from 'pino';
import { env } from '../src/config/env.js';
import { logDB } from '../src/config/log-database.js';
import { resolvePostgresSslConfig } from '../src/config/postgres-ssl.js';
import { EventProcessor, type EventProcessorResult } from '../src/modules/ingestion/workers/event-processor.js';
import { WorkerMetrics } from '../src/modules/ingestion/workers/metrics-server.js';
import { TelemetryWriter, type ScopedEvent } from '../src/modules/ingestion/pipeline/telemetry-writer.js';
import { INGEST_QUEUES, type IngestJobPayload, type PlanTier } from '../src/modules/ingestion/queue/ingest-queues.js';
import type { SdkEventType } from '../src/modules/ingestion/pipeline/event-normalizer.js';
import { filterValidRepetitions, summarize as summarizeRuns } from './lib/aggregate.js';
import {
  captureProvenance,
  EvidenceError,
  isBenchEnvironmentAllowed,
  recordMeasured,
  recordUnmeasured,
  resolveBenchEnvironmentAllowlist,
  assertBenchEnvironment,
  type Measured,
  type Provenance,
} from './lib/ingestion-evidence.js';
import { countStatements } from './lib/statement-counter.js';

type BenchMode = 'writer' | 'processor';
type BenchEventType = SdkEventType | 'mixed';
type TrafficProfile = 'low' | 'normal' | 'burst';

/** Requirement 10.1 / 16.1: how far a recorded WAL figure can be trusted. */
type WalAttribution = 'exclusive_cluster' | 'shared_cluster';

/**
 * What the LSN delta actually spans.
 *
 * `transaction` — sampled immediately before `BEGIN` and immediately after
 * `COMMIT`, which is the Requirement 10.1 window exactly.
 * `batch_call` — sampled around `EventProcessor.process()`, which owns its own
 * `BEGIN`/`COMMIT` internally. That span is a superset of the transaction, so
 * the figure is an upper bound on the transaction's WAL even on a quiet
 * cluster. Recorded rather than silently conflated with the exact case.
 */
type WalSampleScope = 'transaction' | 'batch_call';

interface SignalMixEntry {
  signal: SdkEventType;
  weight: number;
  sharePct: number;
}

interface OrgSpec {
  /** Benchmark-only label, used for per-org reporting in this harness's JSON. */
  label: string;
  orgId: string;
  projectId: string;
  apiKeyId: string;
  apiKeyName: string;
  weight: number;
  offeredSharePct: number;
}

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

  // ── Phase 2 ──
  /** Warm-up window length. 0 disables the window and uses `warmupBatches`. */
  warmupSeconds: number;
  /** Measurement window length. 0 disables the window and uses `batches`. */
  durationSeconds: number;
  /** Repetitions of (warm-up window + measurement window). */
  repetitions: number;
  /** Sustained mode: time-boxed windows with the Requirement 17.1 minimums. */
  sustained: boolean;
  /** Safety cap on batches per window, so a time-boxed loop cannot run away. */
  maxBatchesPerWindow: number;
  wal: boolean;
  countStatements: boolean;
  /** Abort when the environment label is not allowlisted (Requirement 5.4). */
  assertEnvironment: boolean;
  signalMix: SignalMixEntry[] | null;
  orgShares: OrgSpec[] | null;
  /** pm2 process whose restart count answers Requirement 15.6. */
  pm2AppName: string;
}

interface BatchOrgResult {
  offered: number;
  inserted: number;
  outboxInserted: number;
  duplicates: number;
  /** Per-stage samples, populated only where the stage is attributable to one org. */
  stageMs: Record<string, number[]>;
}

interface BatchResult {
  totalMs: number;
  inserted: number;
  stageMs: Record<string, number>;
  outboxInserted?: number;

  // ── Phase 2 ──
  /** Events handed to the write path, whether or not they persisted. */
  submitted: number;
  duplicates: number;
  /** Serialized size of the offered events, for the MB/s figure. */
  bytes: number;
  typeCounts: Record<string, number>;
  perOrg: Record<string, BatchOrgResult>;
  /** LSN delta across the batch, or null when WAL was not sampled. */
  walBytes: number | null;
  /** Log DB pool connection count observed after the batch settled. */
  poolTotal: number;
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

/** Quantiles as the Requirement 17.2 record wants them. */
interface Quantiles {
  p50: number;
  p95: number;
  p99: number;
}

interface OrgRepetitionRecord {
  label: string;
  organizationId: string;
  /** Configured share of offered events, or null when no mix was specified. */
  offeredSharePct: number | null;
  offeredEvents: number;
  observedSharePct: number;
  insertedEvents: number | null;
  outboxInserted: number | null;
  duplicates: number | null;
  eventsPerSecond: number | null;
  queueWaitMs: Quantiles | null;
  transactionMs: Quantiles | null;
  /**
   * Requirement 14.3 also asks for the deferral count and the count of jobs
   * admitted after `INGESTION_FAIRNESS_MAX_DEFERS`. Both are produced by the
   * fairness gate in `WorkerRegistry.runOne()`, which this harness does not
   * execute — it drives `EventProcessor` directly. Recorded as the reason
   * rather than as 0, which would assert that no deferral happened.
   */
  deferralsUnavailableReason: string;
}

/** One repetition of (warm-up window, measurement window). */
interface BenchRepetition {
  repetition: number;
  warmupSeconds: number;
  measurementSeconds: number;
  warmupBatches: number;
  measurementBatches: number;
  /** False when the measurement window did not run to completion (R17.8). */
  completed: boolean;
  terminationReason: string | null;
  failureClassification: string | null;

  eventsSubmitted: number;
  eventsInserted: number;
  outboxInserted: number;
  bytesSubmitted: number;
  eventsPerSecond: number;
  megabytesPerSecond: number;
  latencyMs: Quantiles;
  queueWaitMs: Quantiles;
  checkoutWaitMs: Quantiles;
  transactionMs: Quantiles;
  insertMs: Quantiles;
  commitMs: Quantiles;
  walBytes: number | null;
  walBytesPerEvent: number | null;
  cpuTimeMs: number;
  residentBytes: number;
  peakResidentMegabytes: number;
  dbConnectionCount: number;
  errorRatePct: number;
  duplicateRatePct: number;
  roundTrips: number | null;
  serverStatements: number | null;
  serverStatementsPerBatch: number | null;
  processRestarts: number | null;
  processRestartsUnavailableReason: string | null;
  validForThroughputComparison: boolean;
  organizations: OrgRepetitionRecord[];
  typeCounts: Record<string, number>;
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

/** Slots in the offered-mix allocation cycle. 1000 resolves shares to 0.1 %. */
const MIX_CYCLE_LENGTH = 1000;

/** Requirement 17.1 minimums, applied as the sustained-mode defaults. */
const SUSTAINED_DEFAULT_WARMUP_SECONDS = 10;
const SUSTAINED_DEFAULT_DURATION_SECONDS = 60;

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

  const sustained = boolFlag(args.sustained, false);
  const durationRaw = args['duration-seconds'] ?? args.durationSeconds;
  const warmupRaw = args['warmup-seconds'] ?? args.warmupSeconds;
  const durationSeconds = nonNegativeInt(
    durationRaw,
    sustained ? SUSTAINED_DEFAULT_DURATION_SECONDS : 0,
  );
  const timeBoxed = sustained || durationSeconds > 0;
  const warmupSeconds = nonNegativeInt(
    warmupRaw,
    warmupRaw === undefined && timeBoxed ? SUSTAINED_DEFAULT_WARMUP_SECONDS : 0,
  );

  const tenants = positiveInt(args.tenants ?? args.tenantCount, 1);
  const apiKeyName = String(args.apiKeyName ?? 'bench_ingestion_key');

  return {
    mode,
    type,
    batches: positiveInt(args.batches, 25),
    batchSize: positiveInt(args['batch-size'] ?? args.batchSize, 200),
    warmupBatches: positiveInt(args['warmup-batches'] ?? args.warmupBatches, 3),
    tenants,
    trafficProfile,
    interBatchDelayMs: nonNegativeInt(args['inter-batch-delay-ms'] ?? args.interBatchDelayMs, profileDelayMs),
    commit: args.commit === true || args.commit === 'true',
    orgId: String(args.org ?? args.orgId ?? '11111111-1111-4111-8111-111111111111'),
    projectId: String(args.project ?? args.projectId ?? '22222222-2222-4222-8222-222222222222'),
    apiKeyId: String(args.apiKeyId ?? '33333333-3333-4333-8333-333333333333'),
    apiKeyName,
    environment: String(args.environment ?? 'benchmark'),
    planTier: String(args.planTier ?? 'enterprise') as PlanTier,
    outPath: typeof args.out === 'string' ? args.out : null,

    warmupSeconds,
    durationSeconds,
    repetitions: positiveInt(args.repetitions, 1),
    sustained,
    maxBatchesPerWindow: positiveInt(args['max-batches-per-window'] ?? args.maxBatchesPerWindow, 1_000_000),
    // WAL sampling and statement counting add work per batch, so they stay off
    // for the legacy batch-count invocations every existing consumer uses and
    // default on for the Phase 2 time-boxed modes. Both are explicitly
    // overridable in either direction.
    wal: boolFlag(args.wal, timeBoxed),
    countStatements: boolFlag(args['count-statements'] ?? args.countStatements, timeBoxed),
    assertEnvironment: boolFlag(args['assert-environment'] ?? args.assertEnvironment, timeBoxed),
    signalMix: parseSignalMix(args['signal-mix'] ?? args.signalMix),
    orgShares: parseOrgShares(args['org-shares'] ?? args.orgShares, apiKeyName),
    pm2AppName: String(args['pm2-app-name'] ?? args.pm2AppName ?? 'ingestion-workers'),
  };
}

/**
 * Resolve a boolean flag that must support explicit negation.
 *
 * `--wal` and `--wal true` enable; `--no-wal` and `--wal false` disable;
 * absence takes the caller's default. Needed because the Phase 2 defaults are
 * mode-dependent and a caller has to be able to override them either way.
 */
function boolFlag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === 'true' || value === '1' || value === 'yes') return true;
  if (value === false || value === 'false' || value === '0' || value === 'no') return false;
  return fallback;
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

/** `key=weight` pairs, or bare `weight` values positional to their ordinal. */
function parseWeightSpec(raw: unknown): Array<{ key: string | null; weight: number }> {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const entries: Array<{ key: string | null; weight: number }> = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const equals = trimmed.indexOf('=');
    if (equals < 0) {
      const weight = Number(trimmed);
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`Unsupported weight ${JSON.stringify(trimmed)}: expected a positive number`);
      }
      entries.push({ key: null, weight });
      continue;
    }
    const key = trimmed.slice(0, equals).trim();
    const weight = Number(trimmed.slice(equals + 1).trim());
    if (key === '') throw new Error(`Unsupported weight entry ${JSON.stringify(trimmed)}: empty key`);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`Unsupported weight for ${key}: ${JSON.stringify(trimmed)}; expected a positive number`);
    }
    entries.push({ key, weight });
  }
  return entries;
}

/**
 * Parse `--signal-mix trace=30,span=30,request=15,error=15,log=10`.
 *
 * Weights are relative and are normalized to percentages, so `3,3,1` and
 * `30,30,10` describe the same composition. Requirement 13.1 states its
 * composition in percentages of offered events, which is what `sharePct`
 * records.
 */
function parseSignalMix(raw: unknown): SignalMixEntry[] | null {
  const entries = parseWeightSpec(raw);
  if (entries.length === 0) return null;

  const seen = new Set<string>();
  const weighted: Array<{ signal: SdkEventType; weight: number }> = [];
  for (const entry of entries) {
    if (entry.key === null) {
      throw new Error('--signal-mix requires <signal>=<weight> entries, e.g. trace=30,span=30');
    }
    if (!eventTypes.has(entry.key as SdkEventType)) {
      throw new Error(`Unsupported --signal-mix signal ${entry.key}`);
    }
    if (seen.has(entry.key)) throw new Error(`--signal-mix lists ${entry.key} more than once`);
    seen.add(entry.key);
    weighted.push({ signal: entry.key as SdkEventType, weight: entry.weight });
  }

  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  return weighted.map((entry) => ({
    signal: entry.signal,
    weight: entry.weight,
    sharePct: (entry.weight / total) * 100,
  }));
}

/**
 * Deterministic tenant identifiers for ordinal `n` (1-based).
 *
 * Shared with `tenantContext()` so `--tenants 5` and a five-way `--org-shares`
 * address the same five organizations, which is what makes the Requirement 14.4
 * comparison against a `--tenants`-based baseline meaningful.
 */
function tenantIdentifiers(ordinal: number, apiKeyName: string): Omit<OrgSpec, 'label' | 'weight' | 'offeredSharePct'> {
  const suffix = String(ordinal).padStart(12, '0');
  return {
    orgId: `11111111-1111-4111-8111-${suffix}`,
    projectId: `22222222-2222-4222-8222-${suffix}`,
    apiKeyId: `33333333-3333-4333-8333-${suffix}`,
    apiKeyName: `${apiKeyName}_${ordinal}`,
  };
}

/**
 * Parse `--org-shares flood=90,small1=4,small2=3,small3=2,small4=1` or the
 * positional `--org-shares 90,4,3,2,1`.
 *
 * The label is a benchmark-only reporting name; the organization identifier is
 * always the deterministic tenant id for the entry's ordinal, so a share
 * specification never invents an identifier the rest of the harness cannot
 * reproduce.
 */
function parseOrgShares(raw: unknown, apiKeyName: string): OrgSpec[] | null {
  const entries = parseWeightSpec(raw);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const labels = new Set<string>();
  return entries.map((entry, index) => {
    const ordinal = index + 1;
    const label = entry.key ?? `org${ordinal}`;
    if (labels.has(label)) throw new Error(`--org-shares lists ${label} more than once`);
    labels.add(label);
    return {
      label,
      ...tenantIdentifiers(ordinal, apiKeyName),
      weight: entry.weight,
      offeredSharePct: (entry.weight / total) * 100,
    };
  });
}

/**
 * Allocate `cycleLength` slots across weighted entries by the largest-remainder
 * method, spread rather than blocked.
 *
 * At slot `s` the entry with the largest unmet quota `share × (s + 1) − assigned`
 * wins, ties broken by declaration order. The result is deterministic, hits the
 * requested shares to within one slot, and interleaves the entries instead of
 * emitting each in a contiguous run — which matters because a blocked mix would
 * measure ten seconds of pure trace ingestion followed by ten seconds of pure
 * request ingestion rather than the concurrent mixed workload Requirement 13.1
 * describes.
 */
function allocateMixCycle<T>(entries: Array<{ key: T; sharePct: number }>, cycleLength: number): T[] {
  if (entries.length === 0) return [];
  const shares = entries.map((entry) => entry.sharePct / 100);
  const assigned = entries.map(() => 0);
  const cycle: T[] = [];

  for (let slot = 0; slot < cycleLength; slot += 1) {
    let bestIndex = 0;
    let bestDeficit = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < entries.length; i += 1) {
      const deficit = (shares[i] ?? 0) * (slot + 1) - (assigned[i] ?? 0);
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestIndex = i;
      }
    }
    assigned[bestIndex] = (assigned[bestIndex] ?? 0) + 1;
    const winner = entries[bestIndex];
    if (winner !== undefined) cycle.push(winner.key);
  }

  return cycle;
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

/**
 * Unrounded p50/p95/p99 for a repetition record.
 *
 * Separate from `summarize()` on purpose: `summarize()` rounds to whole
 * milliseconds for the human-readable stage tables, and rounding a sub-
 * millisecond stage such as `beginMs` to 0 before it reaches an aggregate would
 * throw the Requirement 10.1 attribution away.
 */
function quantiles(values: number[]): Quantiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
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

/**
 * Mix cycles, built once per run.
 *
 * Kept in module state rather than threaded through every helper because
 * `eventTypeFor()` and `tenantContext()` are called from the batch builder and
 * from the type-count accounting, and both must resolve the same event index to
 * the same signal and the same organization or the recorded composition would
 * not describe the offered load.
 */
let signalCycle: SdkEventType[] = [];
let orgCycle: OrgSpec[] = [];

function initializeMixCycles(config: BenchConfig): void {
  signalCycle = config.signalMix === null
    ? []
    : allocateMixCycle(
      config.signalMix.map((entry) => ({ key: entry.signal, sharePct: entry.sharePct })),
      MIX_CYCLE_LENGTH,
    );
  orgCycle = config.orgShares === null
    ? []
    : allocateMixCycle(
      config.orgShares.map((entry) => ({ key: entry, sharePct: entry.offeredSharePct })),
      MIX_CYCLE_LENGTH,
    );
}

function eventTypeFor(config: BenchConfig, index: number): SdkEventType {
  if (signalCycle.length > 0) {
    return signalCycle[index % signalCycle.length] as SdkEventType;
  }
  if (config.type !== 'mixed') return config.type;
  return mixedEventTypes[index % mixedEventTypes.length] as SdkEventType;
}

type TenantContext = Pick<BenchConfig, 'orgId' | 'projectId' | 'apiKeyId' | 'apiKeyName'>;

function tenantContext(config: BenchConfig, index: number): TenantContext {
  if (orgCycle.length > 0) {
    const spec = orgCycle[index % orgCycle.length];
    if (spec !== undefined) {
      return {
        orgId: spec.orgId,
        projectId: spec.projectId,
        apiKeyId: spec.apiKeyId,
        apiKeyName: spec.apiKeyName,
      };
    }
  }

  if (config.tenants <= 1) {
    return {
      orgId: config.orgId,
      projectId: config.projectId,
      apiKeyId: config.apiKeyId,
      apiKeyName: config.apiKeyName,
    };
  }

  const tenantNumber = (index % config.tenants) + 1;
  return tenantIdentifiers(tenantNumber, config.apiKeyName);
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
  tenant: TenantContext = config,
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

/* ------------------------------------------------------------------------- */
/* WAL sampling (Requirement 10.1, 16.1 — design §7.1)                        */
/* ------------------------------------------------------------------------- */

/**
 * Application names this harness itself opens.
 *
 * A backend of ours is part of the measured work and must not count as the
 * "other non-idle backend" that downgrades WAL attribution to
 * `shared_cluster` — otherwise the harness would always report its own writes
 * as third-party interference and never record an exclusive-cluster figure.
 */
function ownApplicationNames(): string[] {
  return [
    `log_primary_${env.NODE_ENV}`,
    `log_replica_${env.NODE_ENV}`,
    `pulse_ingestion_bench_${env.NODE_ENV}`,
    `pulse_ingestion_bench_wal_${env.NODE_ENV}`,
  ];
}

/**
 * WAL LSN sampler on its own connection.
 *
 * `pg_current_wal_lsn()` must be read from a connection that is *not* inside
 * the measured transaction: issuing it on the transaction's own connection
 * would add a statement to the transaction being measured and would be blocked
 * behind whatever that transaction is doing. A dedicated single-connection pool
 * is the cheapest way to guarantee separation.
 */
class WalSampler {
  private constructor(
    private readonly pool: Pool,
    readonly appName: string,
  ) {}

  static async create(): Promise<{ sampler: WalSampler | null; reason: string | null }> {
    const connectionString = env.LOG_DB_PRIMARY ?? env.DATABASE_URL;
    const appName = `pulse_ingestion_bench_wal_${env.NODE_ENV}`;
    const pool = new Pool({
      connectionString,
      ssl: resolvePostgresSslConfig(connectionString, {
        enabled: env.LOG_DB_SSL_ENABLED,
        rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED,
      }),
      max: 1,
      idleTimeoutMillis: env.LOG_DB_IDLE_TIMEOUT,
      connectionTimeoutMillis: env.LOG_DB_CONNECTION_TIMEOUT,
      application_name: appName,
      allowExitOnIdle: true,
    });

    try {
      // `pg_current_wal_lsn()` errors on a standby, so the capability is probed
      // rather than assumed; the reason is recorded and the run continues
      // without WAL figures instead of aborting a throughput measurement.
      const probe = await pool.query<{ in_recovery: boolean }>('SELECT pg_is_in_recovery() AS in_recovery');
      if (probe.rows[0]?.in_recovery === true) {
        await pool.end().catch(() => undefined);
        return {
          sampler: null,
          reason: 'The Log DB target is in recovery (a standby), where pg_current_wal_lsn() is not '
            + 'available. WAL bytes per batch transaction require a primary.',
        };
      }
      await pool.query('SELECT pg_current_wal_lsn()');
      return { sampler: new WalSampler(pool, appName), reason: null };
    } catch (err) {
      await pool.end().catch(() => undefined);
      return {
        sampler: null,
        reason: `pg_current_wal_lsn() could not be read on a separate connection: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  async lsn(): Promise<string | null> {
    try {
      const result = await this.pool.query<{ lsn: string }>('SELECT pg_current_wal_lsn()::text AS lsn');
      return result.rows[0]?.lsn ?? null;
    } catch {
      return null;
    }
  }

  /** Bytes of WAL between `from` and the current LSN, or null when unreadable. */
  async bytesSince(from: string): Promise<number | null> {
    try {
      const result = await this.pool.query<{ bytes: string }>(
        'SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1::pg_lsn)::text AS bytes',
        [from],
      );
      const bytes = Number(result.rows[0]?.bytes ?? Number.NaN);
      return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
    } catch {
      return null;
    }
  }

  /**
   * Non-idle client backends that do not belong to this harness.
   *
   * Any such backend can write WAL into the same LSN range, which is what makes
   * the delta an upper bound rather than an exact attribution.
   */
  async otherNonIdleBackends(): Promise<number | null> {
    try {
      const result = await this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
           FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
            AND backend_type = 'client backend'
            AND state IS NOT NULL
            AND state <> 'idle'
            AND COALESCE(application_name, '') <> ALL($1::text[])`,
        [ownApplicationNames()],
      );
      const count = Number(result.rows[0]?.count ?? Number.NaN);
      return Number.isFinite(count) ? count : null;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------------- */
/* Statement counting (Requirement 21.3 — design §2.1)                        */
/* ------------------------------------------------------------------------- */

interface PoolStatementCounter {
  tally: () => { roundTrips: number; serverStatements: number };
  reset: () => void;
  restore: () => void;
}

/**
 * Install `countStatements()` on every client the pool hands out.
 *
 * `EventProcessor` acquires its own client from the pool, so wrapping a client
 * we already hold would miss the processor path entirely. Wrapping `connect()`
 * covers both modes with one mechanism.
 *
 * The counter is restored when the client is released, because pg reuses pooled
 * clients: a wrapper left installed would keep counting after the run and would
 * stack a second wrapper on the next acquisition. `EventProcessor` installs its
 * own `client.query` wrapper *after* this one and restores it before releasing,
 * so the two nest correctly and every query is seen exactly once by each.
 */
function instrumentPoolStatements(pool: Pool): PoolStatementCounter {
  const originalConnect = pool.connect.bind(pool);
  let roundTrips = 0;
  let serverStatements = 0;
  let restored = false;

  const patched = (...args: unknown[]): unknown => {
    // The callback form is delegated untouched: it is not used on the ingest
    // path, and silently half-instrumenting it would be worse than not.
    if (typeof args[0] === 'function') {
      return (originalConnect as (...connectArgs: unknown[]) => unknown)(...args);
    }

    const acquired = (originalConnect as () => Promise<PoolClient>)();
    return acquired.then((client) => {
      const counter = countStatements(client);
      const originalRelease = client.release.bind(client);
      let released = false;
      (client as unknown as { release: unknown }).release = (...releaseArgs: unknown[]): unknown => {
        if (!released) {
          released = true;
          const tally = counter.tally();
          roundTrips += tally.roundTrips;
          serverStatements += tally.serverStatements;
          counter.restore();
          (client as unknown as { release: unknown }).release = originalRelease;
        }
        return (originalRelease as (...args: unknown[]) => unknown)(...releaseArgs);
      };
      return client;
    });
  };

  (pool as unknown as { connect: unknown }).connect = patched;

  return {
    tally: () => ({ roundTrips, serverStatements }),
    reset: () => {
      roundTrips = 0;
      serverStatements = 0;
    },
    restore: () => {
      if (restored) return;
      restored = true;
      (pool as unknown as { connect: unknown }).connect = originalConnect;
    },
  };
}

/* ------------------------------------------------------------------------- */
/* pm2 restart count (Requirement 15.6)                                       */
/* ------------------------------------------------------------------------- */

interface Pm2Reading {
  restarts: number | null;
  reason: string | null;
}

/** Cached pm2-level failure, so an unavailable pm2 is not re-probed per run. */
let pm2Unavailable: string | null = null;

/**
 * Restart count of a pm2-managed process.
 *
 * Requirement 15.6 asks for the restart count of the `ingestion-workers`
 * process. It is read from pm2 rather than inferred from the heap figure
 * because `ecosystem.config.cjs` sets `max_memory_restart: '700M'` above the
 * 512 MB `--max-old-space-size`, so RSS can trip a restart that the heap number
 * never predicts. An unavailable pm2 yields `restarts: null` plus a reason; it
 * never yields 0, which would assert that no restart happened.
 */
function readPm2Restarts(appName: string): Pm2Reading {
  if (pm2Unavailable !== null) return { restarts: null, reason: pm2Unavailable };

  const result = spawnSync('pm2', ['jlist'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.error) {
    pm2Unavailable = `pm2 could not be executed (${result.error.message}), so the `
      + `${appName} restart count could not be read.`;
    return { restarts: null, reason: pm2Unavailable };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').trim();
    pm2Unavailable = `\`pm2 jlist\` exited ${String(result.status)}${stderr === '' ? '' : `: ${stderr}`}, `
      + `so the ${appName} restart count could not be read.`;
    return { restarts: null, reason: pm2Unavailable };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout ?? '');
  } catch (err) {
    pm2Unavailable = `\`pm2 jlist\` output was not valid JSON (${
      err instanceof Error ? err.message : String(err)
    }), so the ${appName} restart count could not be read.`;
    return { restarts: null, reason: pm2Unavailable };
  }

  if (!Array.isArray(parsed)) {
    pm2Unavailable = '`pm2 jlist` did not return a process list, so the restart count could not be read.';
    return { restarts: null, reason: pm2Unavailable };
  }

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { name?: unknown; pm2_env?: unknown };
    if (record.name !== appName) continue;
    const pm2Env = typeof record.pm2_env === 'object' && record.pm2_env !== null
      ? record.pm2_env as { restart_time?: unknown }
      : null;
    const restarts = Number(pm2Env?.restart_time ?? Number.NaN);
    if (Number.isFinite(restarts)) return { restarts, reason: null };
    return {
      restarts: null,
      reason: `pm2 reported ${appName} without a numeric restart_time, so the restart count `
        + 'could not be read.',
    };
  }

  return {
    restarts: null,
    reason: `pm2 is reachable but no process named ${JSON.stringify(appName)} is running, so its `
      + 'restart count could not be read. Pass --pm2-app-name to name the managed process, or run '
      + 'the sustained workload against a pm2-managed ingestion-workers process.',
  };
}

/* ------------------------------------------------------------------------- */
/* Batch execution                                                            */
/* ------------------------------------------------------------------------- */

function emptyOrgResult(): BatchOrgResult {
  return { offered: 0, inserted: 0, outboxInserted: 0, duplicates: 0, stageMs: {} };
}

function orgResultFor(perOrg: Record<string, BatchOrgResult>, orgId: string): BatchOrgResult {
  const existing = perOrg[orgId];
  if (existing !== undefined) return existing;
  const created = emptyOrgResult();
  perOrg[orgId] = created;
  return created;
}

/** Offered-event bookkeeping shared by both modes. */
function describeOffered(batch: ScopedEvent[]): {
  bytes: number;
  typeCounts: Record<string, number>;
  perOrg: Record<string, BatchOrgResult>;
} {
  const typeCounts: Record<string, number> = {};
  const perOrg: Record<string, BatchOrgResult> = {};
  for (const row of batch) {
    const type = String(row.event.type);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    if (row.orgId !== undefined && row.orgId !== null) {
      orgResultFor(perOrg, row.orgId).offered += 1;
    }
  }
  return {
    bytes: Buffer.byteLength(JSON.stringify(batch.map((row) => row.event)), 'utf8'),
    typeCounts,
    perOrg,
  };
}

async function runWriterBatch(
  writer: TelemetryWriter,
  config: BenchConfig,
  batchNumber: number,
  runId: string,
  wal: WalSampler | null,
): Promise<BatchResult> {
  const batch = scopedBatch(config, batchNumber, runId);
  const offered = describeOffered(batch);
  const pool = logDB.getPrimaryPool();

  // Sampled before the transaction starts, on a separate connection, so the
  // delta brackets exactly BEGIN … COMMIT (Requirement 10.1).
  const walFrom = wal === null ? null : await wal.lsn();

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
    // `totalMs` is closed here, at the same point as before this extension, so
    // the WAL sample that follows cannot inflate a latency figure an existing
    // consumer compares against a historical run.
    const totalMs = performance.now() - totalStart;
    const walBytes = wal !== null && walFrom !== null ? await wal.bytesSince(walFrom) : null;

    return {
      totalMs,
      inserted: result.totalInserted,
      outboxInserted: result.outboxInserted ?? 0,
      stageMs,
      submitted: batch.length,
      duplicates: Math.max(0, batch.length - result.totalInserted),
      bytes: offered.bytes,
      typeCounts: offered.typeCounts,
      perOrg: offered.perOrg,
      walBytes,
      poolTotal: pool.totalCount,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function runProcessorBatch(
  processor: EventProcessor,
  config: BenchConfig,
  batchNumber: number,
  runId: string,
  wal: WalSampler | null,
): Promise<BatchResult> {
  const scoped = scopedBatch(config, batchNumber, runId);
  const offered = describeOffered(scoped);
  const totalStart = performance.now();
  const jobs = new Map<string, { type: SdkEventType; events: unknown[]; tenant: TenantContext }>();
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
  let duplicates = 0;
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

  // In processor mode `BEGIN`/`COMMIT` live inside `EventProcessor.process()`,
  // so the sample brackets the whole batch call. That is a superset of the
  // transaction and is recorded as `walSampleScope: 'batch_call'` rather than
  // presented as the transaction's exact WAL.
  const walFrom = wal === null ? null : await wal.lsn();

  for (const job of jobs.values()) {
    const summary = await processor.process(
      jobPayload(config, job.type, job.events, batchNumber, runId, job.tenant),
      INGEST_QUEUES[job.type],
    );
    inserted += summary.inserted;
    outboxInserted += summary.outboxInserted;
    duplicates += summary.duplicates;
    addStages(summary);

    // A job is single-organization by construction (the grouping key leads with
    // orgId), so its result attributes cleanly to one org — which is what makes
    // the Requirement 14.3 per-org figures measurable in this mode.
    const orgResult = orgResultFor(offered.perOrg, job.tenant.orgId);
    orgResult.inserted += summary.inserted;
    orgResult.outboxInserted += summary.outboxInserted;
    orgResult.duplicates += summary.duplicates;
    for (const [stage, ms] of Object.entries(summary.timings)) {
      (orgResult.stageMs[stage] ??= []).push(ms);
    }
    if (summary.queueWaitMs != null) {
      (orgResult.stageMs.queueWaitMs ??= []).push(summary.queueWaitMs);
    }
  }

  const totalMs = performance.now() - totalStart;
  const walBytes = wal !== null && walFrom !== null ? await wal.bytesSince(walFrom) : null;

  return {
    totalMs,
    inserted,
    outboxInserted,
    stageMs,
    submitted: scoped.length,
    duplicates,
    bytes: offered.bytes,
    typeCounts: offered.typeCounts,
    perOrg: offered.perOrg,
    walBytes,
    poolTotal: logDB.getPrimaryPool().totalCount,
  };
}

/* ------------------------------------------------------------------------- */
/* Repetition windows (Requirement 1.7, 11.1, 17.1)                           */
/* ------------------------------------------------------------------------- */

interface WindowOutcome {
  results: BatchResult[];
  batches: number;
  /** Wall milliseconds of the window, measured from its first batch. */
  elapsedMs: number;
  start: ResourceSnapshot | null;
  end: ResourceSnapshot;
  peakRssBytes: number;
  peakHeapUsedBytes: number;
  failedEvents: number;
  terminationReason: string | null;
}

interface RunnerContext {
  config: BenchConfig;
  runId: string;
  writer: TelemetryWriter;
  processor: EventProcessor | null;
  wal: WalSampler | null;
  /** Monotonic batch counter across the whole run, so event ids stay unique. */
  nextBatchNumber: () => number;
  /** True in legacy batch-count single-repetition mode: a failure must be loud. */
  rethrowOnFailure: boolean;
}

async function runBatch(context: RunnerContext, batchNumber: number): Promise<BatchResult> {
  const { config } = context;
  return config.mode === 'processor'
    ? runProcessorBatch(context.processor as EventProcessor, config, batchNumber, context.runId, context.wal)
    : runWriterBatch(context.writer, config, batchNumber, context.runId, context.wal);
}

/**
 * Run one window of batches, either time-boxed or batch-count bounded.
 *
 * `collect` is false for the warm-up window: its batches execute, but nothing
 * they produce is retained, which is how "discard the warm-up window from every
 * reported value" is enforced structurally rather than by remembering to filter
 * later.
 */
async function runWindow(
  context: RunnerContext,
  options: {
    collect: boolean;
    durationSeconds: number;
    batchCount: number;
    /** Sleep after the final batch too, because another window follows. */
    delayAfterLastBatch: boolean;
  },
): Promise<WindowOutcome> {
  const { config } = context;
  const timeBoxed = options.durationSeconds > 0;
  const results: BatchResult[] = [];
  let batches = 0;
  let failedEvents = 0;
  let terminationReason: string | null = null;

  const startedAt = performance.now();
  const start = options.collect ? snapshotResources() : null;
  let peakRssBytes = start?.memory.rss ?? process.memoryUsage().rss;
  let peakHeapUsedBytes = start?.memory.heapUsed ?? process.memoryUsage().heapUsed;
  const deadline = timeBoxed ? startedAt + options.durationSeconds * 1000 : Number.POSITIVE_INFINITY;

  const shouldContinue = (): boolean => {
    if (batches >= config.maxBatchesPerWindow) return false;
    return timeBoxed ? performance.now() < deadline : batches < options.batchCount;
  };

  while (shouldContinue()) {
    const batchNumber = context.nextBatchNumber();
    try {
      const result = await runBatch(context, batchNumber);
      batches += 1;
      if (options.collect) {
        results.push(result);
        const memory = process.memoryUsage();
        peakRssBytes = Math.max(peakRssBytes, memory.rss);
        peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
      }
    } catch (err) {
      // Legacy behaviour: a batch-count run with one repetition fails loudly,
      // exactly as it did before this extension.
      if (context.rethrowOnFailure) throw err;
      batches += 1;
      failedEvents += config.batchSize;
      terminationReason = err instanceof Error ? err.message : String(err);
      break;
    }

    const moreToCome = shouldContinue();
    if (config.interBatchDelayMs > 0 && (moreToCome || options.delayAfterLastBatch)) {
      await sleep(config.interBatchDelayMs);
    }
  }

  return {
    results,
    batches,
    elapsedMs: Math.max(0, performance.now() - startedAt),
    start,
    end: snapshotResources(),
    peakRssBytes,
    peakHeapUsedBytes,
    failedEvents,
    terminationReason,
  };
}

function stageValues(results: BatchResult[], stage: string): number[] {
  return results
    .map((row) => row.stageMs[stage])
    .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms));
}

/**
 * Transaction duration per batch.
 *
 * Processor mode records `transactionMs` directly. Writer mode has no such
 * stage: the batch's whole `totalMs` is the connection-plus-transaction span,
 * which is the closest honest stand-in, so it is used and the substitution is
 * recorded in the output as `transactionMsSource`.
 */
function transactionValues(results: BatchResult[]): { values: number[]; source: 'transactionMs' | 'totalMs' } {
  const recorded = stageValues(results, 'transactionMs');
  if (recorded.length > 0) return { values: recorded, source: 'transactionMs' };
  return { values: results.map((row) => row.totalMs), source: 'totalMs' };
}

function orgRecordsFor(
  config: BenchConfig,
  results: BatchResult[],
  windowSeconds: number,
): OrgRepetitionRecord[] {
  const merged = new Map<string, BatchOrgResult>();
  for (const result of results) {
    for (const [orgId, org] of Object.entries(result.perOrg)) {
      const existing = merged.get(orgId) ?? emptyOrgResult();
      existing.offered += org.offered;
      existing.inserted += org.inserted;
      existing.outboxInserted += org.outboxInserted;
      existing.duplicates += org.duplicates;
      for (const [stage, values] of Object.entries(org.stageMs)) {
        (existing.stageMs[stage] ??= []).push(...values);
      }
      merged.set(orgId, existing);
    }
  }

  const totalOffered = [...merged.values()].reduce((sum, org) => sum + org.offered, 0);
  const specByOrgId = new Map((config.orgShares ?? []).map((spec) => [spec.orgId, spec]));
  const attributed = config.mode === 'processor';
  const deferralsUnavailableReason =
    'Requirement 14.3 deferral counts and post-max-defer admissions are produced by the fairness '
    + 'gate in WorkerRegistry.runOne(), which this harness does not execute — it drives '
    + 'EventProcessor directly. Recorded as unavailable rather than as zero.';

  return [...merged.entries()]
    .map(([orgId, org]) => {
      const spec = specByOrgId.get(orgId);
      const queueWait = org.stageMs.queueWaitMs ?? [];
      const transaction = org.stageMs.transactionMs ?? [];
      return {
        label: spec?.label ?? orgId,
        organizationId: orgId,
        offeredSharePct: spec?.offeredSharePct ?? null,
        offeredEvents: org.offered,
        observedSharePct: totalOffered === 0 ? 0 : (org.offered / totalOffered) * 100,
        insertedEvents: attributed ? org.inserted : null,
        outboxInserted: attributed ? org.outboxInserted : null,
        duplicates: attributed ? org.duplicates : null,
        eventsPerSecond: attributed && windowSeconds > 0 ? org.inserted / windowSeconds : null,
        queueWaitMs: queueWait.length > 0 ? quantiles(queueWait) : null,
        transactionMs: transaction.length > 0 ? quantiles(transaction) : null,
        deferralsUnavailableReason,
      };
    })
    .sort((a, b) => b.offeredEvents - a.offeredEvents);
}

function repetitionRecord(options: {
  config: BenchConfig;
  repetition: number;
  warmup: WindowOutcome;
  measurement: WindowOutcome;
  statements: { roundTrips: number; serverStatements: number } | null;
  restarts: Pm2Reading;
}): BenchRepetition {
  const { config, measurement, warmup } = options;
  const results = measurement.results;
  const windowMs = measurement.elapsedMs;
  const windowSeconds = windowMs / 1000;

  const eventsSubmitted = results.reduce((sum, row) => sum + row.submitted, 0) + measurement.failedEvents;
  const eventsInserted = results.reduce((sum, row) => sum + row.inserted, 0);
  const outboxInserted = results.reduce((sum, row) => sum + (row.outboxInserted ?? 0), 0);
  const bytesSubmitted = results.reduce((sum, row) => sum + row.bytes, 0);
  const duplicates = results.reduce((sum, row) => sum + row.duplicates, 0);

  const walSamples = results
    .map((row) => row.walBytes)
    .filter((bytes): bytes is number => typeof bytes === 'number');
  const walBytes = walSamples.length > 0 ? walSamples.reduce((sum, bytes) => sum + bytes, 0) : null;

  const cpu = measurement.start ? process.cpuUsage(measurement.start.cpu) : null;
  const cpuTimeMs = cpu === null ? 0 : Math.round((cpu.user + cpu.system) / 1000);

  const typeCounts: Record<string, number> = {};
  for (const row of results) {
    for (const [type, count] of Object.entries(row.typeCounts)) {
      typeCounts[type] = (typeCounts[type] ?? 0) + count;
    }
  }

  const errorRatePct = eventsSubmitted === 0 ? 0 : (measurement.failedEvents / eventsSubmitted) * 100;
  const completed = measurement.terminationReason === null && results.length > 0;
  const terminationReason = measurement.terminationReason
    ?? (results.length === 0 ? 'The measurement window completed no batch.' : null);

  const transaction = transactionValues(results);

  return {
    repetition: options.repetition,
    warmupSeconds: warmup.elapsedMs / 1000,
    measurementSeconds: windowSeconds,
    warmupBatches: warmup.batches,
    measurementBatches: measurement.batches,
    completed,
    terminationReason,
    failureClassification: measurement.terminationReason === null ? null : 'batch_execution_error',
    eventsSubmitted,
    eventsInserted,
    outboxInserted,
    bytesSubmitted,
    eventsPerSecond: windowSeconds > 0 ? eventsInserted / windowSeconds : 0,
    megabytesPerSecond: windowSeconds > 0 ? bytesSubmitted / 1_048_576 / windowSeconds : 0,
    latencyMs: quantiles(results.map((row) => row.totalMs)),
    queueWaitMs: quantiles(stageValues(results, 'queueWaitMs')),
    checkoutWaitMs: quantiles(stageValues(results, 'dbConnectionWaitMs')),
    transactionMs: quantiles(transaction.values),
    insertMs: quantiles(stageValues(results, 'insertMs')),
    commitMs: quantiles(stageValues(results, config.commit || config.mode === 'processor' ? 'commitMs' : 'rollbackMs')),
    walBytes,
    walBytesPerEvent: walBytes !== null && eventsInserted > 0 ? walBytes / eventsInserted : null,
    cpuTimeMs,
    residentBytes: measurement.end.memory.rss,
    peakResidentMegabytes: measurement.peakRssBytes / 1_048_576,
    dbConnectionCount: results.reduce((max, row) => Math.max(max, row.poolTotal), 0),
    errorRatePct,
    duplicateRatePct: eventsSubmitted === 0 ? 0 : (duplicates / eventsSubmitted) * 100,
    roundTrips: options.statements?.roundTrips ?? null,
    serverStatements: options.statements?.serverStatements ?? null,
    serverStatementsPerBatch: options.statements !== null && results.length > 0
      ? options.statements.serverStatements / results.length
      : null,
    processRestarts: options.restarts.restarts,
    processRestartsUnavailableReason: options.restarts.reason,
    validForThroughputComparison: completed && errorRatePct <= 1,
    organizations: orgRecordsFor(config, results, windowSeconds),
    typeCounts,
  };
}

/* ------------------------------------------------------------------------- */
/* Evidence emission (Requirement 17.2, 17.4, 17.5, 17.6)                     */
/* ------------------------------------------------------------------------- */

/**
 * Build a `Measured<number>` from the per-repetition values of one metric.
 *
 * `provenance.repetitions` is set to the number of runs the value actually
 * summarizes, which is what `recordMeasured()` enforces against `runs.length`.
 * An empty or non-finite series records the Unmeasured_Declaration plus the
 * reason instead of collapsing to zero.
 */
function measuredFrom(
  values: number[],
  baseProvenance: Provenance,
  unmeasuredReason: string,
): Measured<number> {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    return recordUnmeasured(unmeasuredReason, { ...baseProvenance, repetitions: 0 });
  }
  const aggregate = summarizeRuns(values);
  if (aggregate === null) {
    return recordUnmeasured(unmeasuredReason, { ...baseProvenance, repetitions: 0 });
  }
  return recordMeasured({
    runs: values,
    median: aggregate.median,
    min: aggregate.min,
    max: aggregate.max,
    provenance: { ...baseProvenance, repetitions: aggregate.count },
  });
}

/** The exact argv of this run, recorded as `Provenance.command`. */
function commandLine(): string {
  return process.argv
    .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
    .join(' ');
}

async function main(): Promise<void> {
  const config = parseArgs();
  initializeMixCycles(config);

  const timeBoxed = config.sustained || config.durationSeconds > 0;
  const environmentAllowlisted = isBenchEnvironmentAllowed(config.environment);
  // Requirement 5.4: the Phase 2 time-boxed modes refuse a non-allowlisted
  // environment before the pool is opened. Legacy batch-count invocations keep
  // their existing behaviour and record the verdict instead of aborting, so the
  // Requirement 17.4 gate can reject the bundle downstream.
  if (config.assertEnvironment) assertBenchEnvironment(config.environment);

  let provenance: Provenance | null = null;
  let provenanceError: string | null = null;
  let guardedDirtyFiles: string[] = [];
  let treeCleanForGuardedPaths: boolean | null = null;
  try {
    const captured = captureProvenance({
      command: commandLine(),
      environment: config.environment,
      repetitions: 0,
      assertEnvironment: false,
    });
    provenance = captured.provenance;
    guardedDirtyFiles = captured.tree.guardedDirtyFiles;
    treeCleanForGuardedPaths = captured.tree.cleanTree;
  } catch (err) {
    // Without a Git commit no measurement can satisfy Requirement 1.2, so the
    // `Measured<T>` block is omitted and the reason recorded. The legacy output
    // fields are unaffected, so the harness stays usable outside a work tree.
    provenanceError = err instanceof Error ? err.message : String(err);
  }

  const runId = randomUUID().slice(0, 8);
  const writer = new TelemetryWriter(logDB.getPrimaryPool(), noopLogger);
  const metrics = new WorkerMetrics();
  let primaryPool: Pool | null = null;
  let processor: EventProcessor | null = null;
  let walSampler: WalSampler | null = null;
  let walUnavailableReason: string | null = null;
  let statementCounter: PoolStatementCounter | null = null;
  const results: BatchResult[] = [];
  const repetitions: BenchRepetition[] = [];

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

    if (config.wal) {
      const created = await WalSampler.create();
      walSampler = created.sampler;
      walUnavailableReason = created.reason;
    } else {
      walUnavailableReason = 'WAL sampling was not enabled for this run; pass --wal to sample '
        + 'pg_current_wal_lsn() on a separate connection around each batch transaction.';
    }

    if (config.countStatements) {
      statementCounter = instrumentPoolStatements(logDB.getPrimaryPool());
    }

    let batchCounter = 0;
    const context: RunnerContext = {
      config,
      runId,
      writer,
      processor,
      wal: walSampler,
      nextBatchNumber: () => {
        const current = batchCounter;
        batchCounter += 1;
        return current;
      },
      rethrowOnFailure: !timeBoxed && config.repetitions === 1,
    };

    let otherBackendsMax = 0;
    let otherBackendsObserved = false;
    let firstMeasurementStart: ResourceSnapshot | null = null;
    let lastMeasurementEnd: ResourceSnapshot | null = null;
    let overallPeakRss = process.memoryUsage().rss;
    let overallPeakHeapUsed = process.memoryUsage().heapUsed;

    for (let repetition = 1; repetition <= config.repetitions; repetition += 1) {
      const isLastRepetition = repetition === config.repetitions;

      const warmup = await runWindow(context, {
        collect: false,
        durationSeconds: timeBoxed ? config.warmupSeconds : 0,
        batchCount: timeBoxed ? 0 : config.warmupBatches,
        // A measurement batch always follows the warm-up window, so the
        // inter-batch delay applies after its last batch too — which is what the
        // pre-extension single continuous loop did.
        delayAfterLastBatch: true,
      });

      const restartsBefore = readPm2Restarts(config.pm2AppName);
      statementCounter?.reset();

      if (walSampler !== null) {
        const observed = await walSampler.otherNonIdleBackends();
        if (observed !== null) {
          otherBackendsObserved = true;
          otherBackendsMax = Math.max(otherBackendsMax, observed);
        }
      }

      const measurement = await runWindow(context, {
        collect: true,
        durationSeconds: timeBoxed ? config.durationSeconds : 0,
        batchCount: timeBoxed ? 0 : config.batches,
        delayAfterLastBatch: !isLastRepetition,
      });

      if (walSampler !== null) {
        const observed = await walSampler.otherNonIdleBackends();
        if (observed !== null) {
          otherBackendsObserved = true;
          otherBackendsMax = Math.max(otherBackendsMax, observed);
        }
      }

      const statements = statementCounter?.tally() ?? null;
      const restartsAfter = readPm2Restarts(config.pm2AppName);
      const restarts: Pm2Reading = restartsBefore.restarts !== null && restartsAfter.restarts !== null
        ? { restarts: Math.max(0, restartsAfter.restarts - restartsBefore.restarts), reason: null }
        : { restarts: null, reason: restartsAfter.reason ?? restartsBefore.reason };

      repetitions.push(repetitionRecord({
        config,
        repetition,
        warmup,
        measurement,
        statements,
        restarts,
      }));

      results.push(...measurement.results);
      if (firstMeasurementStart === null) firstMeasurementStart = measurement.start;
      lastMeasurementEnd = measurement.end;
      overallPeakRss = Math.max(overallPeakRss, measurement.peakRssBytes);
      overallPeakHeapUsed = Math.max(overallPeakHeapUsed, measurement.peakHeapUsedBytes);
    }

    const resourceStart = firstMeasurementStart;
    const resourceEnd = lastMeasurementEnd ?? snapshotResources();

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
    // Counted from the batches that were actually built and measured, so the
    // figure stays exact under time-boxed windows and repetitions where a batch
    // index cannot be recomputed from the configured counts.
    const typeCounts: Record<string, number> = {};
    for (const row of results) {
      for (const [type, count] of Object.entries(row.typeCounts)) {
        typeCounts[type] = (typeCounts[type] ?? 0) + count;
      }
    }

    const workerMetrics = config.mode === 'processor' ? metrics.render(null) : undefined;

    // ── Requirement 17.8 / 17.9: excluded repetitions never reach an aggregate ──
    const validity = filterValidRepetitions(repetitions);
    const validRepetitions = validity.valid;
    const walAttribution: WalAttribution = otherBackendsMax > 0 ? 'shared_cluster' : 'exclusive_cluster';

    const measured = provenance === null ? null : {
      eventsPerSecond: measuredFrom(
        validRepetitions.map((rep) => rep.eventsPerSecond),
        provenance,
        'No repetition completed its measurement window with an error rate at or below 1 percent, so '
          + 'no throughput value may be reported.',
      ),
      megabytesPerSecond: measuredFrom(
        validRepetitions.map((rep) => rep.megabytesPerSecond),
        provenance,
        'No valid repetition produced a byte throughput measurement.',
      ),
      eventsSubmitted: measuredFrom(
        validRepetitions.map((rep) => rep.eventsSubmitted),
        provenance,
        'No valid repetition submitted events during its measurement window.',
      ),
      latencyMsP95: measuredFrom(
        validRepetitions.map((rep) => rep.latencyMs.p95),
        provenance,
        'No valid repetition produced a batch latency measurement.',
      ),
      transactionMsP50: measuredFrom(
        validRepetitions.map((rep) => rep.transactionMs.p50),
        provenance,
        'No valid repetition produced a transaction duration measurement.',
      ),
      transactionMsP95: measuredFrom(
        validRepetitions.map((rep) => rep.transactionMs.p95),
        provenance,
        'No valid repetition produced a transaction duration measurement.',
      ),
      insertMsP95: measuredFrom(
        validRepetitions.map((rep) => rep.insertMs.p95),
        provenance,
        'No valid repetition produced an INSERT duration measurement.',
      ),
      commitMsP95: measuredFrom(
        validRepetitions.map((rep) => rep.commitMs.p95),
        provenance,
        'No valid repetition produced a COMMIT duration measurement.',
      ),
      queueWaitMsP95: measuredFrom(
        validRepetitions.map((rep) => rep.queueWaitMs.p95),
        provenance,
        'No valid repetition recorded a queue wait; the harness drives EventProcessor directly, so '
          + 'queue wait is only present when the job payload carries an enqueue timestamp.',
      ),
      checkoutWaitMsP95: measuredFrom(
        validRepetitions.map((rep) => rep.checkoutWaitMs.p95),
        provenance,
        'No valid repetition produced a connection checkout wait measurement.',
      ),
      walBytesPerEvent: measuredFrom(
        validRepetitions
          .map((rep) => rep.walBytesPerEvent)
          .filter((value): value is number => value !== null),
        provenance,
        walUnavailableReason
          ?? 'No valid repetition produced a WAL byte measurement for its batch transactions.',
      ),
      cpuTimeMs: measuredFrom(
        validRepetitions.map((rep) => rep.cpuTimeMs),
        provenance,
        'No valid repetition produced a CPU time measurement.',
      ),
      peakResidentMegabytes: measuredFrom(
        validRepetitions.map((rep) => rep.peakResidentMegabytes),
        provenance,
        'No valid repetition produced a peak resident memory measurement.',
      ),
      serverStatementsPerBatch: measuredFrom(
        validRepetitions
          .map((rep) => rep.serverStatementsPerBatch)
          .filter((value): value is number => value !== null),
        provenance,
        'Statement counting was not enabled for this run; pass --count-statements to record server '
          + 'statements per batch transaction.',
      ),
      roundTripsPerBatch: measuredFrom(
        validRepetitions
          .map((rep) => (rep.roundTrips !== null && rep.measurementBatches > 0
            ? rep.roundTrips / rep.measurementBatches
            : null))
          .filter((value): value is number => value !== null),
        provenance,
        'Statement counting was not enabled for this run; pass --count-statements to record client '
          + 'round trips per batch transaction.',
      ),
      errorRatePct: measuredFrom(
        validRepetitions.map((rep) => rep.errorRatePct),
        provenance,
        'No valid repetition produced an error rate measurement.',
      ),
      duplicateRatePct: measuredFrom(
        validRepetitions.map((rep) => rep.duplicateRatePct),
        provenance,
        'No valid repetition produced a duplicate rate measurement.',
      ),
      dbConnectionCount: measuredFrom(
        validRepetitions.map((rep) => rep.dbConnectionCount),
        provenance,
        'No valid repetition produced a database connection count measurement.',
      ),
      processRestarts: measuredFrom(
        validRepetitions
          .map((rep) => rep.processRestarts)
          .filter((value): value is number => value !== null),
        provenance,
        repetitions.find((rep) => rep.processRestartsUnavailableReason !== null)
          ?.processRestartsUnavailableReason
          ?? `The ${config.pm2AppName} restart count could not be read from pm2.`,
      ),
    };

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
        ? summarizeResources(resourceStart, resourceEnd, overallPeakRss, overallPeakHeapUsed)
        : undefined,
      dbPools: {
        log: snapshotPool(logDB.getPrimaryPool()),
        primary: primaryPool ? snapshotPool(primaryPool) : undefined,
      },
      workerMetrics,

      // ── Phase 2 (design §Component map, §7) ──
      phase2: {
        windows: {
          timeBoxed,
          sustained: config.sustained,
          warmupSeconds: config.warmupSeconds,
          durationSeconds: config.durationSeconds,
          warmupBatches: timeBoxed ? null : config.warmupBatches,
          measurementBatches: timeBoxed ? null : config.batches,
          repetitions: config.repetitions,
          warmupDiscarded: true,
          note: 'Batches executed during the warm-up window are discarded: they enter no repetition '
            + 'record, no aggregate and none of the legacy top-level fields.',
        },
        environment: {
          label: config.environment,
          allowlisted: environmentAllowlisted,
          allowlist: resolveBenchEnvironmentAllowlist(),
          asserted: config.assertEnvironment,
        },
        provenance,
        provenanceUnavailableReason: provenanceError,
        treeCleanForGuardedPaths,
        guardedDirtyFiles,
        wal: {
          enabled: config.wal,
          sampled: walSampler !== null,
          unavailableReason: walUnavailableReason,
          sampleScope: (config.mode === 'processor' ? 'batch_call' : 'transaction') satisfies WalSampleScope,
          samplerApplicationName: walSampler?.appName ?? null,
          separateConnection: true,
          attribution: walSampler === null ? null : walAttribution,
          otherNonIdleBackendsMax: otherBackendsObserved ? otherBackendsMax : null,
          upperBound: walSampler !== null && walAttribution === 'shared_cluster',
          note: walSampler === null
            ? 'No WAL figure was recorded for this run.'
            : walAttribution === 'shared_cluster'
              ? `pg_current_wal_lsn() is cluster-wide and ${otherBackendsMax} non-idle client `
                + 'backend(s) outside this harness were observed during the run, so every recorded '
                + 'WAL figure is an UPPER BOUND on this workload\'s WAL rather than an exact '
                + 'attribution.'
              : 'No non-idle client backend outside this harness was observed during the run, so '
                + 'the LSN delta is attributed to this workload.',
        },
        statements: {
          enabled: config.countStatements,
          note: 'roundTrips counts client.query() calls; serverStatements counts the top-level SQL '
            + 'statements those calls carried, which is higher wherever SET LOCAL statements are '
            + 'joined into one round trip.',
        },
        signalMix: config.signalMix,
        organizationShares: config.orgShares,
        perOrganizationLabelsAreBenchmarkOnly: true,
        perOrganizationNote: 'Per-organization figures are emitted only in this harness\'s JSON. No '
          + 'per-organization label is added to the production metric registry, whose cardinality '
          + 'stays bounded by queue and event type.',
        transactionMsSource: transactionValues(results).source,
        restartCountSource: 'pm2 jlist',
        pm2AppName: config.pm2AppName,
        repetitions,
        excludedRepetitions: validity.excluded.map((entry) => ({
          repetition: entry.repetition.repetition,
          reasons: entry.reasons,
          terminationReason: entry.terminationReason,
          errorRatePct: entry.errorRatePct,
          failureClassification: entry.failureClassification,
        })),
        validRepetitionCount: validRepetitions.length,
        measured,
        measuredUnavailableReason: provenance === null
          ? `Measured values were omitted because provenance could not be captured: ${String(provenanceError)}`
          : null,
      },
    }, null, 2);
    if (config.outPath) {
      await mkdir(dirname(config.outPath), { recursive: true });
      await writeFile(config.outPath, `${output}\n`, 'utf8');
    }
    console.log(output);
  } finally {
    statementCounter?.restore();
    await walSampler?.close();
    await processor?.stop().catch(() => undefined);
    await primaryPool?.end().catch(() => undefined);
    await logDB.close().catch(() => undefined);
  }
}

main().catch((err: unknown) => {
  if (err instanceof EvidenceError) {
    console.error(err.message);
    process.exit(err.exitCode);
  }
  console.error(err);
  process.exit(1);
});
