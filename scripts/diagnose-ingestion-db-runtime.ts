/**
 * Read-only runtime diagnostics for ingestion DB latency investigations.
 *
 * Use this while a benchmark or production-like worker run is active. The
 * schema audit proves what is deployed; this script captures live database
 * pressure that can explain high insertMs/commitMs such as lock waits, WAL /
 * checkpoint movement, dead tuples, table/index churn, and pg-boss backlog.
 *
 * ── 1 Hz sampling mode (ingestion-write-path-optimization task 3.1) ─────────
 *
 * `--duration-seconds N` turns the script into the Requirement 3.1 sampler: it
 * takes one full snapshot, samples a light-weight per-Signal_Type series at
 * >= 1 Hz for N seconds while a sustained workload runs, then takes a second
 * full snapshot so every delta section spans exactly the sampled window.
 *
 * Everything the sampling mode adds is **additive**. Without
 * `--duration-seconds` the output is byte-for-byte the shape it has always had,
 * so `scripts/summarize-ingestion-db-runtime.ts` and
 * `scripts/validate-ingestion-evidence-bundle.ts` keep parsing older bundles.
 *
 * Field sources (design §3) — the client-side series are read from the worker's
 * existing `/metrics` endpoint rather than re-instrumented here, because
 * `EventProcessor`, `WriteAdmissionController` and `WorkerRegistry` already
 * export every one of them:
 *
 *   checkoutWaitMs      ingest_stage_latency_ms_quantile{stage="dbConnectionWaitMs"}
 *   transactionMs       ingest_stage_latency_ms_quantile{stage="transactionMs"}
 *   writePermits        ingest_write_admission_permits
 *   admissionInFlight   ingest_write_admission_in_flight
 *   admissionQueued     ingest_write_admission_queued
 *   workerConcurrency   ingest_worker_configured_slots  (= INGESTION_TYPE_WORKER_CONCURRENCY
 *                                                         x INGESTION_TYPE_WORKER_BATCH_SIZE)
 *   active/idle/waiting ingest_db_pool_connections{pool="telemetry"}
 *   queueDepth          ingest_queue_depth_jobs{queue="ingest.<type>"}
 *
 * The one field that is NOT taken from the client is the concurrent ingest write
 * backend count: it is read from `pg_stat_activity` filtered on the write pool's
 * `application_name`, which is what makes Requirement 3.4 measurable **at the
 * database** instead of inferred from the client's own pool counters.
 */
import { readFile, writeFile } from 'fs/promises';
import type { Pool, QueryResultRow } from 'pg';
import { pool as primaryPool, closeDatabase } from '../src/config/database.js';
import { logDB } from '../src/config/log-database.js';
import { env } from '../src/config/env.js';
import {
  SDK_EVENT_TYPES,
  type SdkEventType,
} from '../src/modules/ingestion/pipeline/event-normalizer.js';
import { INGEST_QUEUES } from '../src/modules/ingestion/queue/ingest-queues.js';
import { summarize, type RunAggregate } from './lib/aggregate.js';
import {
  captureProvenance,
  recordMeasured,
  recordUnmeasured,
  UNMEASURED,
  type Measured,
  type Provenance,
} from './lib/ingestion-evidence.js';

type OutputFormat = 'json' | 'markdown';

interface DiagnosticConfig {
  format: OutputFormat;
  outPath: string | null;
  tables: string[];
  samples: number;
  intervalMs: number;
  activityLimit: number;
  /** Requirement 3.1 sampling window in seconds; 0 disables the sampling mode. */
  durationSeconds: number;
  /** Sampling period in ms, clamped to <= 1000 so the >= 1 Hz floor holds. */
  sampleIntervalMs: number;
  /** The value passed on the command line, when it differed from the clamp. */
  sampleIntervalRequestedMs: number | null;
  metricsUrl: string;
  metricsTimeoutMs: number;
  /** Baseline_Record path for the Requirement 3.2 batch-duration comparison. */
  baselinePath: string;
  /** TTL of the DB queue-depth fallback probe, so 1 Hz cannot hammer pgboss.job. */
  queueDepthCacheMs: number;
  environment: string;
}

interface RuntimeSnapshot {
  sampledAt: string;
  logDbPool: ReturnType<typeof logDB.getPoolStats>;
  logDb: {
    database: string;
    version: string;
    activity: QueryResultRow[];
    waitingActivity: QueryResultRow[];
    locks: QueryResultRow[];
    wal: QueryResultRow | null;
    bgwriter: QueryResultRow | null;
    /**
     * PostgreSQL 17 moved the checkpoint counters out of `pg_stat_bgwriter` into
     * `pg_stat_checkpointer`. Read both so the Requirement 10.2 checkpoint
     * attribution has a source on every supported major version; the absent one
     * lands in `optionalStatsUnavailable`.
     */
    checkpointer: QueryResultRow | null;
    databaseStats: QueryResultRow | null;
    relationStats: QueryResultRow[];
    indexStats: QueryResultRow[];
    relationSizes: QueryResultRow[];
    optionalStatsUnavailable: string[];
  };
  primaryDb: {
    database: string;
    activity: QueryResultRow[];
    waitingActivity: QueryResultRow[];
    locks: QueryResultRow[];
    wal: QueryResultRow | null;
    databaseStats: QueryResultRow | null;
    pgbossQueues: QueryResultRow[];
    pgbossActivity: QueryResultRow[];
    pgbossRelationStats: QueryResultRow[];
    pgbossRelationSizes: QueryResultRow[];
    optionalStatsUnavailable: string[];
  };
}

interface RuntimeDiagnostics {
  generatedAt: string;
  intervalMs: number;
  tables: string[];
  snapshots: RuntimeSnapshot[];
  deltas: QueryResultRow[];
  /**
   * Requirement 3.1 sampled series, Requirement 3.2/3.7/3.8 verdicts and the
   * Requirement 10.2 attribution table. `null` when `--duration-seconds` was not
   * supplied, which is what keeps the legacy output shape untouched.
   */
  sampling: SamplingReport | null;
}

const defaultTables = [
  'events_requests',
  'events_errors',
  'events_logs',
  'events_metrics',
  'events_spans',
  'events_traces',
  'events_messages',
  'events_profiles',
  'events_replays',
  'events_cron_checkins',
  'telemetry_outbox',
  'alert_runtime_idempotency_keys',
  'error_groups',
  'analytics_error_groups',
  'ingestion_dead_letter_jobs',
];

/* ------------------------------------------------------------------------- */
/* 1 Hz sampling mode — types (task 3.1, design §3 and §7.1)                  */
/* ------------------------------------------------------------------------- */

/** Requirement 3.2 / 3.7 decision threshold on p95 connection checkout wait. */
const CHECKOUT_WAIT_STARVATION_MS = 5;

/** Requirement 3.1 requires at least one sample per second. */
const MAX_SAMPLE_INTERVAL_MS = 1_000;

/**
 * `application_name` of the dedicated ingestion write pool, set in
 * `src/shared/workers/ingestion-worker-main.ts` as
 * `pulse_ingestion_writes_${NODE_ENV}`. Filtering `pg_stat_activity` on this
 * prefix is what makes the Requirement 3.4 write-connection ceiling observable
 * at the database rather than inferred from the client.
 */
const WRITE_POOL_APPLICATION_NAME_LIKE = 'pulse_ingestion_writes_%';

/** The pool label `WorkerRegistry` gives the telemetry write pool on /metrics. */
const WRITE_POOL_METRICS_LABEL = 'telemetry';

/** pg-boss job states that count towards a queue's pending depth. */
const PENDING_JOB_STATES: readonly string[] = ['created', 'retry'];

/**
 * `pg_stat_wal` counters differenced across the window. `wal_write_time` and
 * `wal_sync_time` are the Requirement 10.2 WAL-flush-latency evidence; the rest
 * give the volume the flush time has to be read against.
 */
const WAL_DELTA_KEYS: readonly string[] = [
  'wal_records',
  'wal_fpi',
  'wal_bytes',
  'wal_buffers_full',
  'wal_write',
  'wal_sync',
  'wal_write_time',
  'wal_sync_time',
];

/** `pg_stat_bgwriter` counters (checkpoint fields present through PostgreSQL 16). */
const BGWRITER_DELTA_KEYS: readonly string[] = [
  'checkpoints_timed',
  'checkpoints_req',
  'checkpoint_write_time',
  'checkpoint_sync_time',
  'buffers_checkpoint',
  'buffers_clean',
  'maxwritten_clean',
  'buffers_backend',
  'buffers_backend_fsync',
  'buffers_alloc',
];

/** `pg_stat_checkpointer` counters (PostgreSQL 17+ home of the checkpoint fields). */
const CHECKPOINTER_DELTA_KEYS: readonly string[] = [
  'num_timed',
  'num_requested',
  'write_time',
  'sync_time',
  'buffers_written',
  'restartpoints_timed',
  'restartpoints_req',
  'restartpoints_done',
];

type Quantile = 'p50' | 'p95' | 'p99';

/** Prometheus quantile label for each reported quantile. */
const QUANTILE_LABELS: Record<Quantile, string> = {
  p50: '0.5',
  p95: '0.95',
  p99: '0.99',
};

type Quantiles = Record<Quantile, number | null>;

interface PrometheusSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/** Process-global values read once per tick and shared by every signal series. */
interface GlobalSample {
  sampledAt: string;
  elapsedMs: number;
  metricsScraped: boolean;
  metricsError: string | null;
  writePoolMax: number | null;
  writePoolMaxSource: 'metrics' | 'config' | null;
  active: number | null;
  idle: number | null;
  waiting: number | null;
  writePermits: number | null;
  admissionInFlight: number | null;
  admissionQueued: number | null;
  admissionQueuedPeak: number | null;
  /** Requirement 3.4, measured at the database. */
  writeBackends: number | null;
  writeBackendsError: string | null;
  /** Requirement 10.2 lock-waiting attribution input. */
  ungrantedLocks: number | null;
  ungrantedLocksError: string | null;
  /** This script's own Log_DB pool, recorded so it is never confused with the worker's. */
  diagnosticPool: ReturnType<typeof logDB.getPoolStats>;
}

/** One tick of one Signal_Type series — every field of the design §3 table. */
interface SignalSample {
  sampledAt: string;
  elapsedMs: number;
  writePoolMax: number | null;
  active: number | null;
  idle: number | null;
  waiting: number | null;
  checkoutWaitMs: Quantiles;
  transactionMs: Quantiles;
  workerConcurrency: number | null;
  workerConcurrencySource: 'metrics' | 'config' | null;
  writePermits: number | null;
  admissionInFlight: number | null;
  admissionQueued: number | null;
  queueDepth: number | null;
  queueDepthReady: number | null;
  queueDepthSource: 'metrics' | 'database' | null;
  writeBackends: number | null;
}

type StarvationStatus =
  /** Requirement 3.2: p95 checkout wait below threshold and batch duration held. */
  | 'absent'
  /** Requirement 3.7: p95 checkout wait at or above threshold. */
  | 'present'
  /** Below threshold, but no Baseline_Record value exists to complete R3.2. */
  | 'pending_baseline'
  /** Below threshold, but batch duration fell below baseline, so R3.2 does not hold. */
  | 'inconclusive'
  /** No sample carried a checkout-wait reading for this Signal_Type. */
  | 'unavailable';

interface StarvationVerdict {
  signal: SdkEventType;
  status: StarvationStatus;
  thresholdMs: number;
  /** The value the rule was applied to: the highest sampled p95 (see `rule`). */
  decisionCheckoutWaitP95Ms: number | null;
  checkoutWaitP95: RunAggregate | null;
  samplesAtOrAboveThreshold: number;
  transactionMsP95: RunAggregate | null;
  baselineTransactionMsP95: number | null;
  baselineSource: string | null;
  /** Requirement 3.2 requires both series to be cited as the supporting evidence. */
  citedSeries: string[];
  /** Requirement 3.7 ranks the remediation P1 when starvation is present. */
  remediationRank: 'P1' | null;
  rule: string;
  declaration?: typeof UNMEASURED;
  reason?: string;
}

/** Every design §3 field, aggregated across the sampling window. */
interface SignalSeries {
  signal: SdkEventType;
  queue: string;
  sampleCount: number;
  samples: SignalSample[];
  writePoolMax: Measured<number>;
  active: Measured<number>;
  idle: Measured<number>;
  waiting: Measured<number>;
  checkoutWaitMsP50: Measured<number>;
  checkoutWaitMsP95: Measured<number>;
  checkoutWaitMsP99: Measured<number>;
  transactionMsP50: Measured<number>;
  transactionMsP95: Measured<number>;
  transactionMsP99: Measured<number>;
  workerConcurrency: Measured<number>;
  writePermits: Measured<number>;
  admissionInFlight: Measured<number>;
  admissionQueued: Measured<number>;
  queueDepth: Measured<number>;
  writeBackends: Measured<number>;
  verdict: StarvationVerdict;
}

interface DeltaSection {
  scope: string;
  source: string;
  available: boolean;
  reason: string | null;
  metrics: Record<string, number | null>;
}

/** The Requirement 10.2 attribution table: one row per candidate cause. */
interface CommitAttribution {
  note: string;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  walFlushLatency: DeltaSection;
  checkpointActivity: DeltaSection;
  lockWaiting: DeltaSection;
  concurrentWritePressure: DeltaSection;
}

interface SamplingReport {
  requirement: string;
  provenance: Provenance;
  durationSeconds: number;
  sampleIntervalMs: number;
  sampleIntervalClampedFromMs: number | null;
  requestedSamples: number;
  observedSamples: number;
  observedSampleRateHz: number | null;
  metricsUrl: string;
  metricsScrapeSuccesses: number;
  metricsScrapeFailures: number;
  firstMetricsError: string | null;
  baseline: {
    path: string;
    loaded: boolean;
    reason: string | null;
  };
  fullSnapshotPolicy: string;
  globalSeries: GlobalSample[];
  perSignal: Record<string, SignalSeries>;
  verdicts: StarvationVerdict[];
  /** Requirement 3.8 — emitted only when all ten Signal_Types record `absent`. */
  remainingInvestigationDirective: string | null;
  remainingInvestigationDirectiveWithheldReason: string | null;
  attribution: CommitAttribution;
}

function usage(): void {
  console.error(`Usage:
  npm run ingestion:db:runtime -- [--format json|markdown] [--out artifacts/ingestion-db-runtime.json] [--tables table_a,table_b] [--samples 2] [--interval-ms 5000] [--activity-limit 20]

  1 Hz sampling mode (Requirement 3.1) — additive; omit --duration-seconds for the legacy output:
  npm run ingestion:db:runtime -- --duration-seconds 300 --sample-interval-ms 1000 \\
    [--metrics-url http://127.0.0.1:9465/metrics] [--metrics-timeout-ms 2000] \\
    [--baseline artifacts/ingestion-phase2/baseline-record.json] \\
    [--queue-depth-cache-ms 3000] [--environment benchmark]

  In sampling mode --samples is overridden: exactly one full snapshot is taken
  before the window and one after it, so every delta section spans the window.
`);
  process.exit(2);
}

function parseArgs(): DiagnosticConfig {
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
  const samples = Number(args.samples ?? 1);
  const intervalMs = Number(args['interval-ms'] ?? 0);
  const activityLimit = Number(args['activity-limit'] ?? 20);
  const durationSeconds = Number(args['duration-seconds'] ?? 0);
  const sampleIntervalMs = Number(args['sample-interval-ms'] ?? MAX_SAMPLE_INTERVAL_MS);
  const metricsTimeoutMs = Number(args['metrics-timeout-ms'] ?? 2_000);
  const queueDepthCacheMs = Number(args['queue-depth-cache-ms'] ?? env.INGESTION_QUEUE_DEPTH_CACHE_MS);
  const tables = typeof args.tables === 'string'
    ? args.tables.split(',').map((table) => table.trim()).filter(Boolean)
    : defaultTables;

  if (tables.length === 0) usage();
  return {
    format: args.format === 'markdown' ? 'markdown' : 'json',
    outPath: typeof args.out === 'string' ? args.out : null,
    tables,
    samples: Number.isFinite(samples) && samples > 0 ? Math.floor(samples) : 1,
    intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? Math.floor(intervalMs) : 0,
    activityLimit: Number.isFinite(activityLimit) && activityLimit > 0 ? Math.floor(activityLimit) : 20,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.floor(durationSeconds)
      : 0,
    // Clamped rather than rejected: a larger period would silently violate the
    // Requirement 3.1 ">= once per second" floor, and a run that quietly samples
    // too slowly is worse than one that ignores an over-large flag.
    sampleIntervalMs: Number.isFinite(sampleIntervalMs) && sampleIntervalMs > 0
      ? Math.min(MAX_SAMPLE_INTERVAL_MS, Math.floor(sampleIntervalMs))
      : MAX_SAMPLE_INTERVAL_MS,
    sampleIntervalRequestedMs: Number.isFinite(sampleIntervalMs) && sampleIntervalMs > MAX_SAMPLE_INTERVAL_MS
      ? Math.floor(sampleIntervalMs)
      : null,
    metricsUrl: typeof args['metrics-url'] === 'string'
      ? args['metrics-url']
      : `http://127.0.0.1:${env.INGESTION_WORKER_METRICS_PORT}/metrics`,
    metricsTimeoutMs: Number.isFinite(metricsTimeoutMs) && metricsTimeoutMs > 0
      ? Math.floor(metricsTimeoutMs)
      : 2_000,
    baselinePath: typeof args.baseline === 'string'
      ? args.baseline
      : 'artifacts/ingestion-phase2/baseline-record.json',
    queueDepthCacheMs: Number.isFinite(queueDepthCacheMs) && queueDepthCacheMs > 0
      ? Math.floor(queueDepthCacheMs)
      : 3_000,
    environment: typeof args.environment === 'string' ? args.environment : 'benchmark',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function optionalOne(pool: Pool, sql: string, unavailable: string[], label: string): Promise<QueryResultRow | null> {
  try {
    const result = await pool.query(sql);
    return result.rows[0] ?? null;
  } catch (err) {
    unavailable.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function relationFilterSql(alias: string): string {
  return `(${alias}.schemaname = 'public' AND ${alias}.relname = ANY($1::text[]))
      OR (${alias}.schemaname || '.' || ${alias}.relname = ANY($1::text[]))`;
}

async function collectSnapshot(config: DiagnosticConfig): Promise<RuntimeSnapshot> {
  const logPool = logDB.getPrimaryPool();
  const unavailable: string[] = [];
  const primaryUnavailable: string[] = [];
  const [
    logDbInfo,
    primaryDbInfo,
    activity,
    waitingActivity,
    locks,
    wal,
    bgwriter,
    checkpointer,
    databaseStats,
    relationStats,
    indexStats,
    relationSizes,
    primaryActivity,
    primaryWaitingActivity,
    primaryLocks,
    primaryWal,
    primaryDatabaseStats,
    pgbossQueues,
    pgbossActivity,
    pgbossRelationStats,
    pgbossRelationSizes,
  ] = await Promise.all([
    logPool.query<{ database: string; version: string }>(
      `SELECT current_database() AS database, version() AS version`,
    ),
    primaryPool.query<{ database: string }>(`SELECT current_database() AS database`),
    logPool.query(
      `
      SELECT
        pid,
        application_name,
        state,
        wait_event_type,
        wait_event,
        now() - query_start AS query_age,
        now() - xact_start AS transaction_age,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND (
          application_name ILIKE '%ingestion%'
          OR application_name ILIKE '%log_primary%'
          OR application_name ILIKE '%worker%'
          OR state <> 'idle'
        )
      ORDER BY query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    logPool.query(
      `
      SELECT
        pid,
        application_name,
        state,
        wait_event_type,
        wait_event,
        now() - query_start AS query_age,
        now() - xact_start AS transaction_age,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type IS NOT NULL
        AND pid <> pg_backend_pid()
      ORDER BY query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    logPool.query(
      `
      SELECT
        a.pid,
        a.application_name,
        a.state,
        a.wait_event_type,
        a.wait_event,
        l.locktype,
        l.mode,
        l.granted,
        n.nspname AS schema_name,
        c.relname AS relation_name,
        now() - a.query_start AS query_age,
        left(regexp_replace(a.query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      LEFT JOIN pg_class c ON c.oid = l.relation
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE a.datname = current_database()
        AND (l.granted = false OR a.wait_event_type = 'Lock')
      ORDER BY l.granted, a.query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    optionalOne(logPool, `SELECT to_jsonb(pg_stat_wal.*) AS stats FROM pg_stat_wal`, unavailable, 'pg_stat_wal'),
    optionalOne(logPool, `SELECT to_jsonb(pg_stat_bgwriter.*) AS stats FROM pg_stat_bgwriter`, unavailable, 'pg_stat_bgwriter'),
    // PostgreSQL 17+ only. Absence is expected on 13–16 and lands in
    // `optionalStatsUnavailable` rather than failing the run.
    optionalOne(logPool, `SELECT to_jsonb(pg_stat_checkpointer.*) AS stats FROM pg_stat_checkpointer`, unavailable, 'pg_stat_checkpointer'),
    optionalOne(
      logPool,
      `
      SELECT to_jsonb(s.*) AS stats
      FROM pg_stat_database s
      WHERE s.datname = current_database()
      `,
      unavailable,
      'pg_stat_database',
    ),
    logPool.query(
      `
      SELECT
        schemaname,
        relname,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_tup_ins,
        n_tup_upd,
        n_tup_del,
        n_tup_hot_upd,
        n_live_tup,
        n_dead_tup,
        vacuum_count,
        autovacuum_count,
        analyze_count,
        autoanalyze_count,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
      FROM pg_stat_user_tables s
      WHERE ${relationFilterSql('s')}
      ORDER BY schemaname, relname
      `,
      [config.tables],
    ),
    logPool.query(
      `
      SELECT
        schemaname,
        relname,
        indexrelname,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch
      FROM pg_stat_user_indexes s
      WHERE ${relationFilterSql('s')}
      ORDER BY schemaname, relname, indexrelname
      `,
      [config.tables],
    ),
    logPool.query(
      `
      SELECT
        n.nspname AS schema_name,
        c.relname AS relation_name,
        pg_total_relation_size(c.oid) AS total_bytes,
        pg_relation_size(c.oid) AS heap_bytes,
        pg_indexes_size(c.oid) AS indexes_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND (
          (n.nspname = 'public' AND c.relname = ANY($1::text[]))
          OR (n.nspname || '.' || c.relname = ANY($1::text[]))
        )
      ORDER BY n.nspname, c.relname
      `,
      [config.tables],
    ),
    primaryPool.query(
      `
      SELECT
        pid,
        application_name,
        state,
        wait_event_type,
        wait_event,
        now() - query_start AS query_age,
        now() - xact_start AS transaction_age,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND (
          application_name ILIKE '%pgboss%'
          OR application_name ILIKE '%ingestion%'
          OR query ILIKE '%pgboss.%'
          OR state <> 'idle'
        )
      ORDER BY query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    primaryPool.query(
      `
      SELECT
        pid,
        application_name,
        state,
        wait_event_type,
        wait_event,
        now() - query_start AS query_age,
        now() - xact_start AS transaction_age,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type IS NOT NULL
        AND pid <> pg_backend_pid()
        AND (
          application_name ILIKE '%pgboss%'
          OR application_name ILIKE '%ingestion%'
          OR query ILIKE '%pgboss.%'
        )
      ORDER BY query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    primaryPool.query(
      `
      SELECT
        a.pid,
        a.application_name,
        a.state,
        a.wait_event_type,
        a.wait_event,
        l.locktype,
        l.mode,
        l.granted,
        n.nspname AS schema_name,
        c.relname AS relation_name,
        now() - a.query_start AS query_age,
        left(regexp_replace(a.query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      LEFT JOIN pg_class c ON c.oid = l.relation
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE a.datname = current_database()
        AND (l.granted = false OR a.wait_event_type = 'Lock')
        AND (
          n.nspname = 'pgboss'
          OR a.application_name ILIKE '%pgboss%'
          OR a.application_name ILIKE '%ingestion%'
          OR a.query ILIKE '%pgboss.%'
        )
      ORDER BY l.granted, a.query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    optionalOne(primaryPool, `SELECT to_jsonb(pg_stat_wal.*) AS stats FROM pg_stat_wal`, primaryUnavailable, 'primary_pg_stat_wal'),
    optionalOne(
      primaryPool,
      `
      SELECT to_jsonb(s.*) AS stats
      FROM pg_stat_database s
      WHERE s.datname = current_database()
      `,
      primaryUnavailable,
      'primary_pg_stat_database',
    ),
    primaryPool.query(
      `
      SELECT
        q.name,
        q.policy,
        q.partition,
        q.table_name,
        q.notify,
        count(j.*) FILTER (WHERE j.state = 'created') AS queued_count,
        count(j.*) FILTER (WHERE j.state = 'retry') AS retry_count,
        count(j.*) FILTER (WHERE j.state = 'active') AS active_count,
        count(j.*) FILTER (WHERE j.state = 'failed') AS failed_count,
        count(j.*) AS total_count,
        min(j.created_on) FILTER (WHERE j.state IN ('created', 'retry')) AS oldest_pending_created_on
      FROM pgboss.queue q
      LEFT JOIN pgboss.job j ON j.name = q.name
      WHERE q.name LIKE 'ingest.%'
      GROUP BY q.name, q.policy, q.partition, q.table_name, q.notify
      ORDER BY q.name
      `,
    ),
    primaryPool.query(
      `
      SELECT
        pid,
        application_name,
        state,
        wait_event_type,
        wait_event,
        now() - query_start AS query_age,
        now() - xact_start AS transaction_age,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query_sample
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND (
          application_name ILIKE '%pgboss%'
          OR application_name ILIKE '%ingestion%'
          OR query ILIKE '%pgboss.%'
        )
      ORDER BY query_start NULLS LAST
      LIMIT $1
      `,
      [config.activityLimit],
    ),
    primaryPool.query(
      `
      SELECT
        schemaname,
        relname,
        seq_scan,
        seq_tup_read,
        idx_scan,
        idx_tup_fetch,
        n_tup_ins,
        n_tup_upd,
        n_tup_del,
        n_tup_hot_upd,
        n_live_tup,
        n_dead_tup,
        vacuum_count,
        autovacuum_count,
        analyze_count,
        autoanalyze_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'pgboss'
      ORDER BY relname
      `,
    ),
    primaryPool.query(
      `
      SELECT
        n.nspname AS schema_name,
        c.relname AS relation_name,
        pg_total_relation_size(c.oid) AS total_bytes,
        pg_relation_size(c.oid) AS heap_bytes,
        pg_indexes_size(c.oid) AS indexes_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'pgboss'
        AND c.relkind IN ('r', 'p')
      ORDER BY pg_total_relation_size(c.oid) DESC
      `,
    ),
  ]);

  return {
    sampledAt: new Date().toISOString(),
    logDbPool: logDB.getPoolStats(),
    logDb: {
      database: logDbInfo.rows[0]?.database ?? '',
      version: logDbInfo.rows[0]?.version ?? '',
      activity: activity.rows,
      waitingActivity: waitingActivity.rows,
      locks: locks.rows,
      wal,
      bgwriter,
      checkpointer,
      databaseStats,
      relationStats: relationStats.rows,
      indexStats: indexStats.rows,
      relationSizes: relationSizes.rows,
      optionalStatsUnavailable: unavailable,
    },
    primaryDb: {
      database: primaryDbInfo.rows[0]?.database ?? '',
      activity: primaryActivity.rows,
      waitingActivity: primaryWaitingActivity.rows,
      locks: primaryLocks.rows,
      wal: primaryWal,
      databaseStats: primaryDatabaseStats,
      pgbossQueues: pgbossQueues.rows,
      pgbossActivity: pgbossActivity.rows,
      pgbossRelationStats: pgbossRelationStats.rows,
      pgbossRelationSizes: pgbossRelationSizes.rows,
      optionalStatsUnavailable: primaryUnavailable,
    },
  };
}

function numeric(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function statsObject(row: QueryResultRow | null): Record<string, unknown> {
  const stats = row?.stats;
  return stats && typeof stats === 'object' && !Array.isArray(stats)
    ? stats as Record<string, unknown>
    : {};
}

function computeDeltas(snapshots: RuntimeSnapshot[]): QueryResultRow[] {
  if (snapshots.length < 2) return [];
  const first = snapshots[0]!;
  const last = snapshots[snapshots.length - 1]!;
  const deltas: QueryResultRow[] = [];

  const firstWal = statsObject(first.logDb.wal);
  const lastWal = statsObject(last.logDb.wal);
  for (const key of WAL_DELTA_KEYS) {
    const start = numeric(firstWal[key]);
    const end = numeric(lastWal[key]);
    if (start !== null && end !== null) deltas.push({ scope: 'log_db_wal', metric: key, delta: end - start });
  }

  const firstDb = statsObject(first.logDb.databaseStats);
  const lastDb = statsObject(last.logDb.databaseStats);
  for (const key of ['xact_commit', 'xact_rollback', 'blks_read', 'blks_hit', 'tup_inserted', 'tup_updated', 'tup_deleted', 'deadlocks', 'temp_bytes']) {
    const start = numeric(firstDb[key]);
    const end = numeric(lastDb[key]);
    if (start !== null && end !== null) deltas.push({ scope: 'log_db_database', metric: key, delta: end - start });
  }

  // Requirement 10.2 checkpoint attribution. `pg_stat_bgwriter` carries the
  // checkpoint counters on PostgreSQL <= 16 and `pg_stat_checkpointer` on 17+;
  // both scopes are emitted so whichever exists is present in the bundle.
  const firstBgwriter = statsObject(first.logDb.bgwriter);
  const lastBgwriter = statsObject(last.logDb.bgwriter);
  for (const key of BGWRITER_DELTA_KEYS) {
    const start = numeric(firstBgwriter[key]);
    const end = numeric(lastBgwriter[key]);
    if (start !== null && end !== null) deltas.push({ scope: 'log_db_bgwriter', metric: key, delta: end - start });
  }

  const firstCheckpointer = statsObject(first.logDb.checkpointer);
  const lastCheckpointer = statsObject(last.logDb.checkpointer);
  for (const key of CHECKPOINTER_DELTA_KEYS) {
    const start = numeric(firstCheckpointer[key]);
    const end = numeric(lastCheckpointer[key]);
    if (start !== null && end !== null) deltas.push({ scope: 'log_db_checkpointer', metric: key, delta: end - start });
  }

  // Requirement 10.2 lock-waiting attribution, from the full snapshots. The 1 Hz
  // sampler supplies the far denser series; this row keeps the attribution
  // populated when the sampling mode was not used.
  deltas.push({
    scope: 'log_db_lock_waits',
    metric: 'ungranted_lock_rows_last_snapshot',
    delta: last.logDb.locks.filter((row) => row.granted === false).length,
  });

  const firstTables = new Map(first.logDb.relationStats.map((row) => [`${row.schemaname}.${row.relname}`, row]));
  for (const row of last.logDb.relationStats) {
    const key = `${row.schemaname}.${row.relname}`;
    const start = firstTables.get(key);
    if (!start) continue;
    for (const metric of ['seq_scan', 'seq_tup_read', 'idx_scan', 'n_tup_ins', 'n_tup_upd', 'n_tup_del', 'n_dead_tup']) {
      const startValue = numeric(start[metric]);
      const endValue = numeric(row[metric]);
      if (startValue !== null && endValue !== null) {
        deltas.push({ scope: 'log_db_table', relation: key, metric, delta: endValue - startValue });
      }
    }
  }

  const firstRelationSizes = new Map(first.logDb.relationSizes.map((row) => [`${row.schema_name}.${row.relation_name}`, row]));
  for (const row of last.logDb.relationSizes) {
    const key = `${row.schema_name}.${row.relation_name}`;
    const start = firstRelationSizes.get(key);
    if (!start) continue;
    for (const metric of ['total_bytes', 'heap_bytes', 'indexes_bytes']) {
      const startValue = numeric(start[metric]);
      const endValue = numeric(row[metric]);
      if (startValue !== null && endValue !== null) {
        deltas.push({ scope: 'log_db_relation_size', relation: key, metric, delta: endValue - startValue });
      }
    }
  }

  const firstPrimaryWal = statsObject(first.primaryDb.wal);
  const lastPrimaryWal = statsObject(last.primaryDb.wal);
  for (const key of WAL_DELTA_KEYS) {
    const start = numeric(firstPrimaryWal[key]);
    const end = numeric(lastPrimaryWal[key]);
    if (start !== null && end !== null) deltas.push({ scope: 'primary_db_wal', metric: key, delta: end - start });
  }

  const firstPrimaryDb = statsObject(first.primaryDb.databaseStats);
  const lastPrimaryDb = statsObject(last.primaryDb.databaseStats);
  for (const key of ['xact_commit', 'xact_rollback', 'blks_read', 'blks_hit', 'tup_inserted', 'tup_updated', 'tup_deleted', 'deadlocks', 'temp_bytes']) {
    const start = numeric(firstPrimaryDb[key]);
    const end = numeric(lastPrimaryDb[key]);
    if (start !== null && end !== null) deltas.push({ scope: 'primary_db_database', metric: key, delta: end - start });
  }

  const firstPgbossTables = new Map(first.primaryDb.pgbossRelationStats.map((row) => [`${row.schemaname}.${row.relname}`, row]));
  for (const row of last.primaryDb.pgbossRelationStats) {
    const key = `${row.schemaname}.${row.relname}`;
    const start = firstPgbossTables.get(key);
    if (!start) continue;
    for (const metric of ['seq_scan', 'seq_tup_read', 'idx_scan', 'n_tup_ins', 'n_tup_upd', 'n_tup_del', 'n_dead_tup']) {
      const startValue = numeric(start[metric]);
      const endValue = numeric(row[metric]);
      if (startValue !== null && endValue !== null) {
        deltas.push({ scope: 'primary_pgboss_table', relation: key, metric, delta: endValue - startValue });
      }
    }
  }

  const firstPgbossRelationSizes = new Map(first.primaryDb.pgbossRelationSizes.map((row) => [`${row.schema_name}.${row.relation_name}`, row]));
  for (const row of last.primaryDb.pgbossRelationSizes) {
    const key = `${row.schema_name}.${row.relation_name}`;
    const start = firstPgbossRelationSizes.get(key);
    if (!start) continue;
    for (const metric of ['total_bytes', 'heap_bytes', 'indexes_bytes']) {
      const startValue = numeric(start[metric]);
      const endValue = numeric(row[metric]);
      if (startValue !== null && endValue !== null) {
        deltas.push({ scope: 'primary_pgboss_relation_size', relation: key, metric, delta: endValue - startValue });
      }
    }
  }
  return deltas;
}

/* ------------------------------------------------------------------------- */
/* 1 Hz sampling mode — implementation (task 3.1)                             */
/* ------------------------------------------------------------------------- */

/**
 * Minimal Prometheus text-exposition parser.
 *
 * Only what the worker's `/metrics` endpoint actually emits is handled: comment
 * lines, `name value`, and `name{label="v",...} value`. Label values are
 * unescaped for `\\`, `\"` and `\n`, matching the escaping `metrics-server.ts`
 * applies.
 */
export function parsePrometheusText(body: string): PrometheusSample[] {
  const samples: PrometheusSample[] = [];

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const braceAt = line.indexOf('{');
    let name: string;
    let labels: Record<string, string> = {};
    let rest: string;

    if (braceAt >= 0) {
      const closeAt = line.lastIndexOf('}');
      if (closeAt < braceAt) continue;
      name = line.slice(0, braceAt).trim();
      labels = parsePrometheusLabels(line.slice(braceAt + 1, closeAt));
      rest = line.slice(closeAt + 1).trim();
    } else {
      const spaceAt = line.indexOf(' ');
      if (spaceAt < 0) continue;
      name = line.slice(0, spaceAt).trim();
      rest = line.slice(spaceAt + 1).trim();
    }

    if (name === '') continue;
    // A trailing timestamp is legal in the exposition format; take the value only.
    const valueToken = rest.split(/\s+/)[0] ?? '';
    const value = Number(valueToken);
    if (!Number.isFinite(value)) continue;

    samples.push({ name, labels, value });
  }

  return samples;
}

function parsePrometheusLabels(inner: string): Record<string, string> {
  const labels: Record<string, string> = {};
  let i = 0;

  while (i < inner.length) {
    while (i < inner.length && (inner[i] === ',' || inner[i] === ' ')) i += 1;

    const eq = inner.indexOf('=', i);
    if (eq < 0) break;
    const key = inner.slice(i, eq).trim();

    let j = eq + 1;
    while (j < inner.length && inner[j] === ' ') j += 1;
    if (inner[j] !== '"') break;
    j += 1;

    let value = '';
    while (j < inner.length) {
      const ch = inner[j];
      if (ch === '\\') {
        const next = inner[j + 1];
        if (next === 'n') value += '\n';
        else if (next === '\\') value += '\\';
        else if (next === '"') value += '"';
        else value += next ?? '';
        j += 2;
        continue;
      }
      if (ch === '"') break;
      value += ch;
      j += 1;
    }

    if (key !== '') labels[key] = value;
    i = j + 1;
  }

  return labels;
}

/** Index samples by metric name so each lookup is a map hit, not a rescan. */
function indexPrometheus(samples: PrometheusSample[]): Map<string, PrometheusSample[]> {
  const index = new Map<string, PrometheusSample[]>();
  for (const sample of samples) {
    const bucket = index.get(sample.name);
    if (bucket) bucket.push(sample);
    else index.set(sample.name, [sample]);
  }
  return index;
}

function matchesLabels(sample: PrometheusSample, labels: Record<string, string>): boolean {
  return Object.entries(labels).every(([key, value]) => sample.labels[key] === value);
}

/** First value whose labels match, or `null` when the family or match is absent. */
function promValue(
  index: Map<string, PrometheusSample[]>,
  name: string,
  labels: Record<string, string> = {},
): number | null {
  const bucket = index.get(name);
  if (!bucket) return null;
  const hit = bucket.find((sample) => matchesLabels(sample, labels));
  return hit ? hit.value : null;
}

/**
 * Sum of every value whose labels match `labels` and satisfy `where`.
 *
 * Returns `null` — never `0` — when the metric family is absent, because an
 * absent reading and a genuine zero must not be conflated in the evidence.
 */
function promSum(
  index: Map<string, PrometheusSample[]>,
  name: string,
  labels: Record<string, string> = {},
  where: (sample: PrometheusSample) => boolean = () => true,
): number | null {
  const bucket = index.get(name);
  if (!bucket) return null;
  let total = 0;
  for (const sample of bucket) {
    if (matchesLabels(sample, labels) && where(sample)) total += sample.value;
  }
  return total;
}

function promQuantiles(
  index: Map<string, PrometheusSample[]>,
  name: string,
  labels: Record<string, string>,
): Quantiles {
  return {
    p50: promValue(index, name, { ...labels, quantile: QUANTILE_LABELS.p50 }),
    p95: promValue(index, name, { ...labels, quantile: QUANTILE_LABELS.p95 }),
    p99: promValue(index, name, { ...labels, quantile: QUANTILE_LABELS.p99 }),
  };
}

async function scrapeMetrics(
  url: string,
  timeoutMs: number,
): Promise<{ index: Map<string, PrometheusSample[]> | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'text/plain' },
    });
    if (!response.ok) {
      return { index: null, error: `metrics scrape returned HTTP ${String(response.status)}` };
    }
    return { index: indexPrometheus(parsePrometheusText(await response.text())), error: null };
  } catch (err) {
    return { index: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cached per-queue pending depth read straight from `pgboss.job`.
 *
 * Only used when the worker's `/metrics` endpoint is unreachable. It is cached
 * because the grouped scan is the exact probe Phase 1 had to cache at the
 * gateway; running it uncached at 1 Hz for 300 s would add measurable load to
 * the very system being measured.
 */
class QueueDepthProbe {
  private cachedAt = 0;
  private cached: Map<string, { pending: number; ready: number }> | null = null;
  private lastError: string | null = null;

  constructor(private readonly pool: Pool, private readonly ttlMs: number) {}

  get error(): string | null {
    return this.lastError;
  }

  async read(): Promise<Map<string, { pending: number; ready: number }> | null> {
    const now = Date.now();
    if (this.cached !== null && now - this.cachedAt < this.ttlMs) return this.cached;

    try {
      const result = await this.pool.query<{ name: string; pending: number; ready: number }>(
        `
        SELECT
          name,
          COUNT(*)::int AS pending,
          COUNT(*) FILTER (WHERE start_after <= NOW())::int AS ready
        FROM pgboss.job
        WHERE name = ANY($1::text[])
          AND state = ANY($2::text[])
        GROUP BY name
        `,
        [Object.values(INGEST_QUEUES), [...PENDING_JOB_STATES]],
      );
      const map = new Map<string, { pending: number; ready: number }>();
      for (const row of result.rows) {
        map.set(row.name, { pending: Number(row.pending), ready: Number(row.ready) });
      }
      this.cached = map;
      this.cachedAt = now;
      this.lastError = null;
      return map;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return null;
    }
  }
}

async function collectGlobalSample(
  logPool: Pool,
  config: DiagnosticConfig,
  startedAt: number,
): Promise<{ global: GlobalSample; metrics: Map<string, PrometheusSample[]> | null }> {
  const [scrape, writeBackends, ungrantedLocks] = await Promise.all([
    scrapeMetrics(config.metricsUrl, config.metricsTimeoutMs),
    // Requirement 3.4 measured at the database, not inferred from the client.
    logPool
      .query<{ backends: string }>(
        `SELECT COUNT(*)::bigint AS backends
           FROM pg_stat_activity
          WHERE application_name LIKE $1`,
        [WRITE_POOL_APPLICATION_NAME_LIKE],
      )
      .then((result) => ({ value: numeric(result.rows[0]?.backends), error: null as string | null }))
      .catch((err: unknown) => ({
        value: null,
        error: err instanceof Error ? err.message : String(err),
      })),
    // Requirement 10.2 lock-waiting attribution.
    logPool
      .query<{ ungranted: string }>(
        `SELECT COUNT(*)::bigint AS ungranted FROM pg_locks WHERE NOT granted`,
      )
      .then((result) => ({ value: numeric(result.rows[0]?.ungranted), error: null as string | null }))
      .catch((err: unknown) => ({
        value: null,
        error: err instanceof Error ? err.message : String(err),
      })),
  ]);

  const index = scrape.index;
  // `pool.options.max` is not currently mirrored on /metrics, so the max is read
  // from the same setting that sizes the pool. A `state="max"` sample is
  // preferred if one ever appears, so this stays correct without another edit.
  const metricsPoolMax = index === null
    ? null
    : promValue(index, 'ingest_db_pool_connections', {
        pool: WRITE_POOL_METRICS_LABEL,
        state: 'max',
      });

  return {
    metrics: index,
    global: {
      sampledAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      metricsScraped: index !== null,
      metricsError: scrape.error,
      writePoolMax: metricsPoolMax ?? env.INGESTION_WRITE_POOL_SIZE,
      writePoolMaxSource: metricsPoolMax !== null ? 'metrics' : 'config',
      active: index === null
        ? null
        : promValue(index, 'ingest_db_pool_connections', {
            pool: WRITE_POOL_METRICS_LABEL,
            state: 'in_use',
          }),
      idle: index === null
        ? null
        : promValue(index, 'ingest_db_pool_connections', {
            pool: WRITE_POOL_METRICS_LABEL,
            state: 'idle',
          }),
      waiting: index === null
        ? null
        : promValue(index, 'ingest_db_pool_connections', {
            pool: WRITE_POOL_METRICS_LABEL,
            state: 'waiting',
          }),
      writePermits: index === null ? null : promValue(index, 'ingest_write_admission_permits'),
      admissionInFlight: index === null ? null : promValue(index, 'ingest_write_admission_in_flight'),
      admissionQueued: index === null ? null : promValue(index, 'ingest_write_admission_queued'),
      admissionQueuedPeak: index === null
        ? null
        : promValue(index, 'ingest_write_admission_queued_peak'),
      writeBackends: writeBackends.value,
      writeBackendsError: writeBackends.error,
      ungrantedLocks: ungrantedLocks.value,
      ungrantedLocksError: ungrantedLocks.error,
      diagnosticPool: logDB.getPoolStats(),
    },
  };
}

function collectSignalSample(
  signal: SdkEventType,
  global: GlobalSample,
  index: Map<string, PrometheusSample[]> | null,
  dbDepth: Map<string, { pending: number; ready: number }> | null,
): SignalSample {
  const queue = INGEST_QUEUES[signal];

  const metricsConcurrency = index === null
    ? null
    : promValue(index, 'ingest_worker_configured_slots', { queue, type: signal });

  let queueDepth: number | null = null;
  let queueDepthReady: number | null = null;
  let queueDepthSource: SignalSample['queueDepthSource'] = null;

  if (index !== null) {
    const pending = promSum(index, 'ingest_queue_depth_jobs', { queue }, (sample) =>
      PENDING_JOB_STATES.includes(sample.labels.state ?? ''),
    );
    if (pending !== null) {
      queueDepth = pending;
      queueDepthReady = promSum(index, 'ingest_queue_ready_jobs', { queue }, (sample) =>
        PENDING_JOB_STATES.includes(sample.labels.state ?? ''),
      );
      queueDepthSource = 'metrics';
    }
  }

  if (queueDepth === null && dbDepth !== null) {
    const row = dbDepth.get(queue);
    // A queue with no pending rows is absent from the grouped result, which is a
    // measured zero rather than a missing reading.
    queueDepth = row?.pending ?? 0;
    queueDepthReady = row?.ready ?? 0;
    queueDepthSource = 'database';
  }

  return {
    sampledAt: global.sampledAt,
    elapsedMs: global.elapsedMs,
    writePoolMax: global.writePoolMax,
    active: global.active,
    idle: global.idle,
    waiting: global.waiting,
    checkoutWaitMs: index === null
      ? { p50: null, p95: null, p99: null }
      : promQuantiles(index, 'ingest_stage_latency_ms_quantile', {
          stage: 'dbConnectionWaitMs',
          type: signal,
        }),
    transactionMs: index === null
      ? { p50: null, p95: null, p99: null }
      : promQuantiles(index, 'ingest_stage_latency_ms_quantile', {
          stage: 'transactionMs',
          type: signal,
        }),
    workerConcurrency: metricsConcurrency
      ?? env.INGESTION_TYPE_WORKER_CONCURRENCY * env.INGESTION_TYPE_WORKER_BATCH_SIZE,
    workerConcurrencySource: metricsConcurrency !== null ? 'metrics' : 'config',
    writePermits: global.writePermits,
    admissionInFlight: global.admissionInFlight,
    admissionQueued: global.admissionQueued,
    queueDepth,
    queueDepthReady,
    queueDepthSource,
    writeBackends: global.writeBackends,
  };
}

/* ── Series aggregation into the Measured<T> envelope ──────────────────────── */

/**
 * Wrap one field of a series in `Measured<number>`.
 *
 * `repetitions` is the number of samples that actually carried a reading, which
 * is why every field gets its own provenance clone: a series where 300 samples
 * had a pool count but only 40 had a rolling quantile must not claim 300
 * repetitions for the quantile.
 */
function measureField(
  samples: SignalSample[] | GlobalSample[],
  select: (sample: never) => number | null,
  baseProvenance: Provenance,
  label: string,
): Measured<number> {
  const runs: number[] = [];
  for (const sample of samples) {
    const value = select(sample as never);
    if (value !== null && Number.isFinite(value)) runs.push(value);
  }

  const aggregate = summarize(runs);
  if (aggregate === null) {
    return recordUnmeasured<number>(
      `${label}: no sample in the window carried a reading (samples=${String(samples.length)}).`,
      { ...baseProvenance, repetitions: 0 },
    );
  }

  return recordMeasured<number>({
    runs,
    median: aggregate.median,
    min: aggregate.min,
    max: aggregate.max,
    provenance: { ...baseProvenance, repetitions: runs.length },
  });
}

/* ── Baseline_Record lookup for the Requirement 3.2 comparison ─────────────── */

interface BaselineLookup {
  loaded: boolean;
  reason: string | null;
  transactionMsP95: Map<string, number>;
  source: string | null;
}

function readQuantileP95(entry: unknown): number | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  if (record.status === 'unmeasured') return null;
  for (const key of ['value', 'median'] as const) {
    const holder = record[key];
    if (typeof holder === 'object' && holder !== null) {
      const p95 = (holder as Record<string, unknown>).p95;
      const value = numeric(p95);
      if (value !== null) return value;
    }
    const direct = numeric(holder);
    if (direct !== null) return direct;
  }
  return null;
}

/**
 * Load `perSignal[signal].transactionMs` p95 from the Baseline_Record.
 *
 * A missing or unreadable baseline is recorded, never substituted: the verdict
 * for every Signal_Type then becomes `pending_baseline` rather than a comparison
 * against an invented number.
 */
async function loadBaseline(path: string): Promise<BaselineLookup> {
  const empty = new Map<string, number>();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      loaded: false,
      reason: `Baseline_Record not read from ${path}: ${message}`,
      transactionMsP95: empty,
      source: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      loaded: false,
      reason: `Baseline_Record at ${path} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
      transactionMsP95: empty,
      source: null,
    };
  }

  const perSignal = (parsed as { perSignal?: unknown } | null)?.perSignal;
  if (typeof perSignal !== 'object' || perSignal === null) {
    return {
      loaded: false,
      reason: `Baseline_Record at ${path} carries no perSignal block.`,
      transactionMsP95: empty,
      source: null,
    };
  }

  const map = new Map<string, number>();
  for (const [signal, metrics] of Object.entries(perSignal as Record<string, unknown>)) {
    if (typeof metrics !== 'object' || metrics === null) continue;
    const p95 = readQuantileP95((metrics as Record<string, unknown>).transactionMs);
    if (p95 !== null) map.set(signal, p95);
  }

  return {
    loaded: true,
    reason: map.size === 0
      ? `Baseline_Record at ${path} recorded no measured transactionMs p95 for any Signal_Type.`
      : null,
    transactionMsP95: map,
    source: `${path} -> perSignal.<signal>.transactionMs.p95`,
  };
}

/* ── Requirement 3.2 / 3.7 / 3.8 verdict ──────────────────────────────────── */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function describeAggregate(aggregate: RunAggregate | null): string {
  if (aggregate === null) return 'no reading';
  return `median ${String(round2(aggregate.median))} ms, min ${String(round2(aggregate.min))} ms, max ${
    String(round2(aggregate.max))
  } ms over ${String(aggregate.count)} samples`;
}

function decideStarvation(
  signal: SdkEventType,
  samples: SignalSample[],
  baseline: BaselineLookup,
): StarvationVerdict {
  const checkoutP95Runs = samples
    .map((sample) => sample.checkoutWaitMs.p95)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const transactionP95Runs = samples
    .map((sample) => sample.transactionMs.p95)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const checkoutAggregate = summarize(checkoutP95Runs);
  const transactionAggregate = summarize(transactionP95Runs);
  const baselineP95 = baseline.transactionMsP95.get(signal) ?? null;
  const citedSeries = [
    `sampling.perSignal.${signal}.samples[].checkoutWaitMs.p95`,
    `sampling.perSignal.${signal}.samples[].transactionMs.p95`,
  ];

  if (checkoutAggregate === null) {
    return {
      signal,
      status: 'unavailable',
      thresholdMs: CHECKOUT_WAIT_STARVATION_MS,
      decisionCheckoutWaitP95Ms: null,
      checkoutWaitP95: null,
      samplesAtOrAboveThreshold: 0,
      transactionMsP95: transactionAggregate,
      baselineTransactionMsP95: baselineP95,
      baselineSource: baseline.source,
      citedSeries,
      remediationRank: null,
      rule:
        'No sampled p95 connection checkout wait was recorded for this Signal_Type, so neither '
        + 'Requirement 3.2 nor Requirement 3.7 can be evaluated.',
      declaration: UNMEASURED,
      reason:
        `No ingest_stage_latency_ms_quantile{stage="dbConnectionWaitMs",type="${signal}"} sample was `
        + 'scraped during the window. Either no batch of this Signal_Type was processed, or the '
        + 'worker metrics endpoint was unreachable.',
    };
  }

  // The decision value is the HIGHEST sampled p95, not the median. Requirement 3.7
  // fires on "at or above 5 ms": averaging a starvation episode away would let a
  // window that genuinely starved be recorded as absent, so the conservative
  // extreme decides and the full distribution is recorded beside it.
  const decision = checkoutAggregate.max;
  const atOrAbove = checkoutP95Runs.filter((value) => value >= CHECKOUT_WAIT_STARVATION_MS).length;

  if (decision >= CHECKOUT_WAIT_STARVATION_MS) {
    return {
      signal,
      status: 'present',
      thresholdMs: CHECKOUT_WAIT_STARVATION_MS,
      decisionCheckoutWaitP95Ms: decision,
      checkoutWaitP95: checkoutAggregate,
      samplesAtOrAboveThreshold: atOrAbove,
      transactionMsP95: transactionAggregate,
      baselineTransactionMsP95: baselineP95,
      baselineSource: baseline.source,
      citedSeries,
      remediationRank: 'P1',
      rule:
        `R3.7: highest sampled p95 checkout wait ${String(round2(decision))} ms >= `
        + `${String(CHECKOUT_WAIT_STARVATION_MS)} ms in ${String(atOrAbove)} of `
        + `${String(checkoutAggregate.count)} samples (${describeAggregate(checkoutAggregate)}); `
        + `batch transaction duration p95 ${describeAggregate(transactionAggregate)}. `
        + 'Connection starvation present; remediation ranked P1.',
    };
  }

  if (baselineP95 === null) {
    return {
      signal,
      status: 'pending_baseline',
      thresholdMs: CHECKOUT_WAIT_STARVATION_MS,
      decisionCheckoutWaitP95Ms: decision,
      checkoutWaitP95: checkoutAggregate,
      samplesAtOrAboveThreshold: atOrAbove,
      transactionMsP95: transactionAggregate,
      baselineTransactionMsP95: null,
      baselineSource: baseline.source,
      citedSeries,
      remediationRank: null,
      rule:
        `R3.2 half-satisfied: highest sampled p95 checkout wait ${String(round2(decision))} ms < `
        + `${String(CHECKOUT_WAIT_STARVATION_MS)} ms (${describeAggregate(checkoutAggregate)}), but no `
        + 'Baseline_Record batch transaction duration p95 exists for this Signal_Type, so the second '
        + 'clause cannot be evaluated. Verdict pending; '
        + (baseline.reason ?? 'the baseline recorded no value for this Signal_Type.'),
    };
  }

  if (transactionAggregate === null) {
    return {
      signal,
      status: 'pending_baseline',
      thresholdMs: CHECKOUT_WAIT_STARVATION_MS,
      decisionCheckoutWaitP95Ms: decision,
      checkoutWaitP95: checkoutAggregate,
      samplesAtOrAboveThreshold: atOrAbove,
      transactionMsP95: null,
      baselineTransactionMsP95: baselineP95,
      baselineSource: baseline.source,
      citedSeries,
      remediationRank: null,
      rule:
        `R3.2 half-satisfied: highest sampled p95 checkout wait ${String(round2(decision))} ms < `
        + `${String(CHECKOUT_WAIT_STARVATION_MS)} ms, but no sampled batch transaction duration p95 was `
        + 'recorded for this Signal_Type, so it cannot be compared against the Baseline_Record value '
        + `${String(round2(baselineP95))} ms. Verdict pending.`,
      declaration: UNMEASURED,
      reason:
        `No ingest_stage_latency_ms_quantile{stage="transactionMs",type="${signal}"} sample was `
        + 'scraped during the window.',
    };
  }

  if (transactionAggregate.median >= baselineP95) {
    return {
      signal,
      status: 'absent',
      thresholdMs: CHECKOUT_WAIT_STARVATION_MS,
      decisionCheckoutWaitP95Ms: decision,
      checkoutWaitP95: checkoutAggregate,
      samplesAtOrAboveThreshold: atOrAbove,
      transactionMsP95: transactionAggregate,
      baselineTransactionMsP95: baselineP95,
      baselineSource: baseline.source,
      citedSeries,
      remediationRank: null,
      rule:
        `R3.2: highest sampled p95 checkout wait ${String(round2(decision))} ms < `
        + `${String(CHECKOUT_WAIT_STARVATION_MS)} ms (${describeAggregate(checkoutAggregate)}) while `
        + `sampled batch transaction duration p95 ${describeAggregate(transactionAggregate)} stayed at `
        + `or above the Baseline_Record p95 ${String(round2(baselineP95))} ms. Connection starvation `
        + 'absent; the cost sits in PostgreSQL execution and write work, not in connection acquisition.',
    };
  }

  return {
    signal,
    status: 'inconclusive',
    thresholdMs: CHECKOUT_WAIT_STARVATION_MS,
    decisionCheckoutWaitP95Ms: decision,
    checkoutWaitP95: checkoutAggregate,
    samplesAtOrAboveThreshold: atOrAbove,
    transactionMsP95: transactionAggregate,
    baselineTransactionMsP95: baselineP95,
    baselineSource: baseline.source,
    citedSeries,
    remediationRank: null,
    rule:
      `Neither R3.2 nor R3.7 holds: highest sampled p95 checkout wait ${String(round2(decision))} ms < `
      + `${String(CHECKOUT_WAIT_STARVATION_MS)} ms, but sampled batch transaction duration p95 median `
      + `${String(round2(transactionAggregate.median))} ms fell below the Baseline_Record p95 `
      + `${String(round2(baselineP95))} ms, so the R3.2 conjunction fails. Recorded as inconclusive `
      + 'rather than as absence, because the run was not comparable to the baseline.',
  };
}

function buildDirective(verdicts: StarvationVerdict[]): {
  directive: string | null;
  withheld: string | null;
} {
  const notAbsent = verdicts.filter((verdict) => verdict.status !== 'absent');
  if (notAbsent.length === 0) {
    return {
      directive:
        'R3.8: connection starvation is recorded as absent for all ten Signal_Types. Remaining '
        + 'investigation is directed to PostgreSQL execution and write cost — index maintenance, WAL '
        + 'generation, trigger execution, constraint checking, TOAST activity and COMMIT flush — not '
        + 'to connection pool or write-admission tuning.',
      withheld: null,
    };
  }
  return {
    directive: null,
    withheld:
      'R3.8 directive withheld: it applies only when all ten Signal_Types record starvation as '
      + `absent. Not absent: ${
        notAbsent.map((verdict) => `${verdict.signal}=${verdict.status}`).join(', ')
      }.`,
  };
}

/* ── Requirement 10.2 attribution table ───────────────────────────────────── */

function deltaSection(
  scope: string,
  source: string,
  keys: readonly string[],
  first: Record<string, unknown>,
  last: Record<string, unknown>,
  unavailableReason: string | null,
): DeltaSection {
  const metrics: Record<string, number | null> = {};
  let any = false;
  for (const key of keys) {
    const start = numeric(first[key]);
    const end = numeric(last[key]);
    if (start !== null && end !== null) {
      metrics[key] = end - start;
      any = true;
    } else {
      metrics[key] = null;
    }
  }
  return {
    scope,
    source,
    available: any,
    reason: any ? null : unavailableReason ?? `${source} returned no differenceable counter.`,
    metrics,
  };
}

function buildAttribution(
  snapshots: RuntimeSnapshot[],
  globalSeries: GlobalSample[],
): CommitAttribution {
  const first = snapshots[0] ?? null;
  const last = snapshots.length > 1 ? snapshots[snapshots.length - 1] ?? null : null;

  const wal = last === null
    ? emptySection('log_db_wal', 'pg_stat_wal', WAL_DELTA_KEYS,
        'Fewer than two full snapshots were taken, so no WAL counter could be differenced.')
    : deltaSection('log_db_wal', 'pg_stat_wal', WAL_DELTA_KEYS,
        statsObject(first?.logDb.wal ?? null), statsObject(last.logDb.wal), null);

  const bgwriter = last === null
    ? emptySection('log_db_bgwriter', 'pg_stat_bgwriter', BGWRITER_DELTA_KEYS,
        'Fewer than two full snapshots were taken, so no checkpoint counter could be differenced.')
    : deltaSection('log_db_bgwriter', 'pg_stat_bgwriter', BGWRITER_DELTA_KEYS,
        statsObject(first?.logDb.bgwriter ?? null), statsObject(last.logDb.bgwriter), null);

  const checkpointer = last === null
    ? emptySection('log_db_checkpointer', 'pg_stat_checkpointer', CHECKPOINTER_DELTA_KEYS,
        'Fewer than two full snapshots were taken, so no checkpoint counter could be differenced.')
    : deltaSection('log_db_checkpointer', 'pg_stat_checkpointer', CHECKPOINTER_DELTA_KEYS,
        statsObject(first?.logDb.checkpointer ?? null), statsObject(last.logDb.checkpointer), null);

  // PostgreSQL <= 16 populates pg_stat_bgwriter; 17+ populates pg_stat_checkpointer.
  const checkpointActivity = bgwriter.available ? bgwriter : checkpointer;
  if (!checkpointActivity.available) {
    checkpointActivity.reason =
      'Neither pg_stat_bgwriter nor pg_stat_checkpointer returned a differenceable checkpoint '
      + 'counter; see snapshots[].logDb.optionalStatsUnavailable for the reason.';
  }

  const lockSamples = globalSeries
    .map((sample) => sample.ungrantedLocks)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const lockAggregate = summarize(lockSamples);
  const snapshotUngranted = last === null
    ? (first?.logDb.locks ?? []).filter((row) => row.granted === false).length
    : last.logDb.locks.filter((row) => row.granted === false).length;

  const backendSamples = globalSeries
    .map((sample) => sample.writeBackends)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const backendAggregate = summarize(backendSamples);
  const admissionQueuedSamples = globalSeries
    .map((sample) => sample.admissionQueued)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const admissionQueuedAggregate = summarize(admissionQueuedSamples);

  return {
    note:
      'Requirement 10.2 attribution inputs. When p95 COMMIT duration exceeds p95 summed statement '
      + 'duration by more than 10 percent, the excess is attributed among these four causes, each '
      + 'citing the section below that measured it.',
    windowStartUtc: globalSeries[0]?.sampledAt ?? first?.sampledAt ?? null,
    windowEndUtc:
      globalSeries[globalSeries.length - 1]?.sampledAt ?? last?.sampledAt ?? first?.sampledAt ?? null,
    walFlushLatency: wal,
    checkpointActivity,
    lockWaiting: {
      scope: 'log_db_lock_waits',
      source: 'pg_locks WHERE NOT granted, sampled once per tick; plus the full-snapshot lock rows',
      available: lockAggregate !== null,
      reason: lockAggregate === null
        ? 'No ungranted-lock count was sampled; see globalSeries[].ungrantedLocksError.'
        : null,
      metrics: {
        ungranted_locks_median: lockAggregate?.median ?? null,
        ungranted_locks_min: lockAggregate?.min ?? null,
        ungranted_locks_max: lockAggregate?.max ?? null,
        ungranted_locks_samples: lockAggregate?.count ?? 0,
        ungranted_locks_samples_above_zero: lockSamples.filter((value) => value > 0).length,
        ungranted_lock_rows_last_snapshot: snapshotUngranted,
      },
    },
    concurrentWritePressure: {
      scope: 'log_db_write_backends',
      source: `pg_stat_activity WHERE application_name LIKE '${WRITE_POOL_APPLICATION_NAME_LIKE}'`,
      available: backendAggregate !== null,
      reason: backendAggregate === null
        ? 'No ingest write backend count was sampled; see globalSeries[].writeBackendsError.'
        : null,
      metrics: {
        write_backends_median: backendAggregate?.median ?? null,
        write_backends_min: backendAggregate?.min ?? null,
        write_backends_max: backendAggregate?.max ?? null,
        write_backends_samples: backendAggregate?.count ?? 0,
        configured_write_pool_size: env.INGESTION_WRITE_POOL_SIZE,
        admission_queued_median: admissionQueuedAggregate?.median ?? null,
        admission_queued_max: admissionQueuedAggregate?.max ?? null,
      },
    },
  };
}

function emptySection(
  scope: string,
  source: string,
  keys: readonly string[],
  reason: string,
): DeltaSection {
  const metrics: Record<string, number | null> = {};
  for (const key of keys) metrics[key] = null;
  return { scope, source, available: false, reason, metrics };
}

/* ── The sampling loop ────────────────────────────────────────────────────── */

async function runSampler(
  config: DiagnosticConfig,
  snapshots: RuntimeSnapshot[],
): Promise<SamplingReport> {
  const logPool = logDB.getPrimaryPool();
  const depthProbe = new QueueDepthProbe(primaryPool, config.queueDepthCacheMs);
  const baseline = await loadBaseline(config.baselinePath);

  const command = ['npm run ingestion:db:runtime --', ...process.argv.slice(2)].join(' ');
  // Asserts the environment label against INGESTION_BENCH_ENV_ALLOWLIST and
  // captures the Git commit, so every value below carries Requirement 17.6
  // provenance. Only reached in sampling mode.
  const { provenance } = captureProvenance({
    command,
    environment: config.environment,
    repetitions: 0,
  });

  const globalSeries: GlobalSample[] = [];
  const signalSamples = new Map<SdkEventType, SignalSample[]>();
  for (const signal of SDK_EVENT_TYPES) signalSamples.set(signal, []);

  let scrapeSuccesses = 0;
  let scrapeFailures = 0;
  let firstMetricsError: string | null = null;

  const startedAt = Date.now();
  const deadline = startedAt + config.durationSeconds * 1_000;

  for (let tick = 0; ; tick += 1) {
    // Absolute tick targets rather than "sleep(interval) after work", so the
    // time each collection takes does not accumulate into sampling drift and
    // silently drop the rate below the Requirement 3.1 1 Hz floor.
    const target = startedAt + tick * config.sampleIntervalMs;
    const wait = target - Date.now();
    if (wait > 0) await sleep(wait);
    if (Date.now() > deadline) break;

    const { global, metrics } = await collectGlobalSample(logPool, config, startedAt);
    if (metrics === null) {
      scrapeFailures += 1;
      if (firstMetricsError === null) firstMetricsError = global.metricsError;
    } else {
      scrapeSuccesses += 1;
    }

    const dbDepth = metrics === null ? await depthProbe.read() : null;

    globalSeries.push(global);
    for (const signal of SDK_EVENT_TYPES) {
      signalSamples.get(signal)?.push(collectSignalSample(signal, global, metrics, dbDepth));
    }

    if (Date.now() >= deadline) break;
  }

  const perSignal: Record<string, SignalSeries> = {};
  const verdicts: StarvationVerdict[] = [];

  for (const signal of SDK_EVENT_TYPES) {
    const samples = signalSamples.get(signal) ?? [];
    const verdict = decideStarvation(signal, samples, baseline);
    verdicts.push(verdict);

    const field = (
      select: (sample: SignalSample) => number | null,
      label: string,
    ): Measured<number> =>
      measureField(samples, select as (sample: never) => number | null, provenance, `${signal}.${label}`);

    perSignal[signal] = {
      signal,
      queue: INGEST_QUEUES[signal],
      sampleCount: samples.length,
      samples,
      writePoolMax: field((sample) => sample.writePoolMax, 'writePoolMax'),
      active: field((sample) => sample.active, 'active'),
      idle: field((sample) => sample.idle, 'idle'),
      waiting: field((sample) => sample.waiting, 'waiting'),
      checkoutWaitMsP50: field((sample) => sample.checkoutWaitMs.p50, 'checkoutWaitMs.p50'),
      checkoutWaitMsP95: field((sample) => sample.checkoutWaitMs.p95, 'checkoutWaitMs.p95'),
      checkoutWaitMsP99: field((sample) => sample.checkoutWaitMs.p99, 'checkoutWaitMs.p99'),
      transactionMsP50: field((sample) => sample.transactionMs.p50, 'transactionMs.p50'),
      transactionMsP95: field((sample) => sample.transactionMs.p95, 'transactionMs.p95'),
      transactionMsP99: field((sample) => sample.transactionMs.p99, 'transactionMs.p99'),
      workerConcurrency: field((sample) => sample.workerConcurrency, 'workerConcurrency'),
      writePermits: field((sample) => sample.writePermits, 'writePermits'),
      admissionInFlight: field((sample) => sample.admissionInFlight, 'admissionInFlight'),
      admissionQueued: field((sample) => sample.admissionQueued, 'admissionQueued'),
      queueDepth: field((sample) => sample.queueDepth, 'queueDepth'),
      writeBackends: field((sample) => sample.writeBackends, 'writeBackends'),
      verdict,
    };
  }

  const { directive, withheld } = buildDirective(verdicts);
  const elapsedSeconds = (Date.now() - startedAt) / 1_000;

  return {
    requirement:
      'R3.1 sampled series, R3.2/R3.7/R3.8 starvation verdict, R10.2 attribution inputs.',
    provenance: { ...provenance, repetitions: globalSeries.length },
    durationSeconds: config.durationSeconds,
    sampleIntervalMs: config.sampleIntervalMs,
    sampleIntervalClampedFromMs: config.sampleIntervalRequestedMs,
    requestedSamples: Math.ceil((config.durationSeconds * 1_000) / config.sampleIntervalMs) + 1,
    observedSamples: globalSeries.length,
    observedSampleRateHz: elapsedSeconds > 0 ? round2(globalSeries.length / elapsedSeconds) : null,
    metricsUrl: config.metricsUrl,
    metricsScrapeSuccesses: scrapeSuccesses,
    metricsScrapeFailures: scrapeFailures,
    firstMetricsError,
    baseline: {
      path: config.baselinePath,
      loaded: baseline.loaded,
      reason: baseline.reason,
    },
    fullSnapshotPolicy:
      'One full snapshot before the window and one after it, so every delta section spans exactly '
      + 'the sampled window. --samples is ignored in sampling mode.',
    globalSeries,
    perSignal,
    verdicts,
    remainingInvestigationDirective: directive,
    remainingInvestigationDirectiveWithheldReason: withheld,
    attribution: buildAttribution(snapshots, globalSeries),
  };
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value).replace(/\|/g, '\\|');
  return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function renderRows(headers: string[], rows: QueryResultRow[]): string[] {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((header) => renderCell(row[header])).join(' | ')} |`),
  ];
}

function renderMarkdown(report: RuntimeDiagnostics): string {
  const last = report.snapshots[report.snapshots.length - 1]!;
  return [
    '# Ingestion Runtime DB Diagnostics',
    '',
    `Generated at: ${report.generatedAt}`,
    `Samples: ${report.snapshots.length}`,
    `Interval ms: ${report.intervalMs}`,
    `Tables: ${report.tables.join(', ')}`,
    '',
    '## Log DB Pool',
    '',
    '```json',
    JSON.stringify(last.logDbPool, null, 2),
    '```',
    '',
    '## Waiting Log DB Activity',
    '',
    ...renderRows(['pid', 'application_name', 'state', 'wait_event_type', 'wait_event', 'query_age', 'transaction_age', 'query_sample'], last.logDb.waitingActivity),
    '',
    '## Log DB Lock Waits',
    '',
    ...renderRows(['pid', 'application_name', 'locktype', 'mode', 'granted', 'schema_name', 'relation_name', 'query_age', 'query_sample'], last.logDb.locks),
    '',
    '## Log DB Table Stats',
    '',
    ...renderRows(['schemaname', 'relname', 'seq_scan', 'idx_scan', 'n_tup_ins', 'n_tup_upd', 'n_tup_del', 'n_live_tup', 'n_dead_tup'], last.logDb.relationStats),
    '',
    '## Log DB Relation Sizes',
    '',
    ...renderRows(['schema_name', 'relation_name', 'total_bytes', 'heap_bytes', 'indexes_bytes'], last.logDb.relationSizes),
    '',
    '## pg-boss Queues',
    '',
    ...renderRows(['name', 'policy', 'partition', 'notify', 'queued_count', 'retry_count', 'active_count', 'failed_count', 'total_count', 'oldest_pending_created_on'], last.primaryDb.pgbossQueues),
    '',
    '## Primary DB pg-boss Activity',
    '',
    ...renderRows(['pid', 'application_name', 'state', 'wait_event_type', 'wait_event', 'query_age', 'transaction_age', 'query_sample'], last.primaryDb.activity),
    '',
    '## Waiting Primary DB pg-boss Activity',
    '',
    ...renderRows(['pid', 'application_name', 'state', 'wait_event_type', 'wait_event', 'query_age', 'transaction_age', 'query_sample'], last.primaryDb.waitingActivity),
    '',
    '## Primary DB pg-boss Lock Waits',
    '',
    ...renderRows(['pid', 'application_name', 'locktype', 'mode', 'granted', 'schema_name', 'relation_name', 'query_age', 'query_sample'], last.primaryDb.locks),
    '',
    '## Primary DB pg-boss Table Stats',
    '',
    ...renderRows(['schemaname', 'relname', 'seq_scan', 'idx_scan', 'n_tup_ins', 'n_tup_upd', 'n_tup_del', 'n_live_tup', 'n_dead_tup'], last.primaryDb.pgbossRelationStats),
    '',
    '## Primary DB pg-boss Relation Sizes',
    '',
    ...renderRows(['schema_name', 'relation_name', 'total_bytes', 'heap_bytes', 'indexes_bytes'], last.primaryDb.pgbossRelationSizes),
    '',
    '## Deltas',
    '',
    ...renderRows(['scope', 'relation', 'metric', 'delta'], report.deltas),
    '',
    last.logDb.optionalStatsUnavailable.length > 0 ? '## Optional Stats Unavailable' : '',
    ...last.logDb.optionalStatsUnavailable.map((item) => `- ${item}`),
    ...last.primaryDb.optionalStatsUnavailable.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const config = parseArgs();
  const snapshots: RuntimeSnapshot[] = [];
  let sampling: SamplingReport | null = null;
  try {
    if (config.durationSeconds > 0) {
      // Sampling mode: one full snapshot, the 1 Hz window, then a second full
      // snapshot, so every delta and attribution section spans exactly the
      // sampled window instead of an arbitrary pair of instants.
      snapshots.push(await collectSnapshot(config));
      sampling = await runSampler(config, snapshots);
      snapshots.push(await collectSnapshot(config));
      sampling.attribution = buildAttribution(snapshots, sampling.globalSeries);
    } else {
      for (let i = 0; i < config.samples; i += 1) {
        if (i > 0 && config.intervalMs > 0) await sleep(config.intervalMs);
        snapshots.push(await collectSnapshot(config));
      }
    }

    const report: RuntimeDiagnostics = {
      generatedAt: new Date().toISOString(),
      intervalMs: config.durationSeconds > 0 ? config.sampleIntervalMs : config.intervalMs,
      tables: config.tables,
      snapshots,
      deltas: computeDeltas(snapshots),
      sampling,
    };
    const output = config.format === 'markdown'
      ? renderMarkdown(report)
      : `${JSON.stringify(report, null, 2)}\n`;
    if (config.outPath) await writeFile(config.outPath, output, 'utf8');
    process.stdout.write(output);
  } finally {
    await logDB.close().catch(() => undefined);
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
