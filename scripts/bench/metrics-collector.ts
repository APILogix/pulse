/**
 * Cross-cutting metrics collector shared by every HTTP-level benchmark mode.
 *
 * Samples, at a fixed interval for the duration of a run:
 *   - worker Prometheus text output (queue depth, jobs/events counters,
 *     admission gauges, DB pool gauges, latency histograms) via HTTP GET;
 *   - PostgreSQL runtime state (active/idle connections, locks, WAL LSN
 *     delta, commits/rollbacks) via a read-only monitoring connection, when a
 *     database URL is supplied and reachable — never required, because an
 *     HTTP-only operator may not have direct DB access to the target.
 *
 * Every sample is timestamped so a report can align "offered rate at T" with
 * "queue depth at T" without assuming samples land on the same tick.
 *
 * Absence is recorded, not guessed: if the metrics endpoint or DB connection
 * is unreachable, samples are simply not emitted for that source and the
 * final report says so explicitly (`sourcesReachable`), rather than filling
 * gaps with zeros.
 */
import { Pool } from 'pg';

export interface WorkerSample {
  atMs: number;
  queueDepthPending: number | null;
  queueDepthReady: number | null;
  queueDepthActive: number | null;
  queueOldestPendingAgeMs: number | null;
  dlqRetainedJobs: number | null;
  writeAdmissionPermits: number | null;
  writeAdmissionInFlight: number | null;
  writeAdmissionQueued: number | null;
  eventsInsertedByType: Record<string, number>;
  eventsReceivedByType: Record<string, number>;
  eventsRejectedByType: Record<string, number>;
  eventsDuplicateByType: Record<string, number>;
  dbPoolTotal: Record<string, number>;
  dbPoolIdle: Record<string, number>;
  dbPoolWaiting: Record<string, number>;
  /** Process-local fairness counters (WorkerRegistry). Cumulative, not per-interval. */
  fairnessDeferredJobsTotal: number | null;
  fairnessProcessedJobsTotal: number | null;
  fairnessStarvationGuardAdmissionsTotal: number | null;
  /** Per-organization in-flight gauge, keyed by org_id label. Process-local, not fleet-wide. */
  orgInFlightJobs: Record<string, number>;
  rawTextBytes: number;
}

export interface DbSample {
  atMs: number;
  activeConnections: number | null;
  idleConnections: number | null;
  totalConnections: number | null;
  waitingLocks: number | null;
  walLsn: string | null;
  commits: number | null;
  rollbacks: number | null;
}

export interface CollectorHandle {
  /** Live snapshot of everything collected so far, without stopping collection. */
  snapshot(): { workerSamples: WorkerSample[]; dbSamples: DbSample[] };
  stop(): Promise<{
    workerSamples: WorkerSample[];
    dbSamples: DbSample[];
    sourcesReachable: { worker: boolean; db: boolean };
  }>;
}

function parsePrometheusText(text: string): Omit<WorkerSample, 'atMs' | 'rawTextBytes'> {
  const lines = text.split('\n');
  const scalar = (name: string): number | null => {
    for (const line of lines) {
      if (line.startsWith('#')) continue;
      const [key, value] = line.split(' ');
      if (key === name) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      }
    }
    return null;
  };
  const byLabel = (namePrefix: string, labelKey: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const line of lines) {
      if (line.startsWith('#') || !line.startsWith(namePrefix)) continue;
      const spaceIdx = line.lastIndexOf(' ');
      if (spaceIdx < 0) continue;
      const value = Number(line.slice(spaceIdx + 1));
      if (!Number.isFinite(value)) continue;
      const labelMatch = line.match(new RegExp(`${labelKey}="([^"]*)"`));
      if (!labelMatch) continue;
      const label = labelMatch[1] ?? 'unknown';
      out[label] = (out[label] ?? 0) + value;
    }
    return out;
  };
  const byPoolLabel = (state: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const line of lines) {
      if (line.startsWith('#') || !line.startsWith('ingest_db_pool_connections{')) continue;
      if (!line.includes(`state="${state}"`)) continue;
      const spaceIdx = line.lastIndexOf(' ');
      if (spaceIdx < 0) continue;
      const value = Number(line.slice(spaceIdx + 1));
      if (!Number.isFinite(value)) continue;
      const poolMatch = line.match(/pool="([^"]*)"/);
      const pool = poolMatch?.[1] ?? 'unknown';
      out[pool] = value;
    }
    return out;
  };

  return {
    queueDepthPending: scalar('ingest_queue_depth_pending'),
    queueDepthReady: scalar('ingest_queue_depth_ready'),
    queueDepthActive: scalar('ingest_queue_depth_active'),
    queueOldestPendingAgeMs: scalar('ingest_queue_oldest_pending_job_age_ms'),
    dlqRetainedJobs: scalar('ingest_dlq_retained_jobs'),
    writeAdmissionPermits: scalar('ingest_write_admission_permits'),
    writeAdmissionInFlight: scalar('ingest_write_admission_in_flight'),
    writeAdmissionQueued: scalar('ingest_write_admission_queued'),
    eventsInsertedByType: byLabel('ingest_events_inserted_by_type_total', 'type'),
    eventsReceivedByType: byLabel('ingest_events_received_by_type_total', 'type'),
    eventsRejectedByType: byLabel('ingest_events_rejected_by_type_total', 'type'),
    eventsDuplicateByType: byLabel('ingest_events_duplicate_total', 'type'),
    dbPoolTotal: byPoolLabel('total'),
    dbPoolIdle: byPoolLabel('idle'),
    dbPoolWaiting: byPoolLabel('waiting'),
    fairnessDeferredJobsTotal: scalar('ingest_fairness_deferred_jobs_total'),
    fairnessProcessedJobsTotal: scalar('ingest_fairness_processed_jobs_total'),
    fairnessStarvationGuardAdmissionsTotal: scalar('ingest_fairness_starvation_guard_admissions_total'),
    orgInFlightJobs: byLabel('ingest_org_inflight_jobs', 'org_id'),
  };
}

async function sampleWorker(metricsUrl: string, timeoutMs: number): Promise<Omit<WorkerSample, 'atMs'> | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(metricsUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    return { ...parsePrometheusText(text), rawTextBytes: Buffer.byteLength(text) };
  } catch {
    return null;
  }
}

async function sampleDb(pool: Pool): Promise<Omit<DbSample, 'atMs'> | null> {
  try {
    const result = await pool.query<{
      active: string;
      idle: string;
      total: string;
      waiting_locks: string;
      wal_lsn: string;
      commits: string;
      rollbacks: string;
    }>(`
      SELECT
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active')::text AS active,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle')::text AS idle,
        (SELECT count(*) FROM pg_stat_activity)::text AS total,
        (SELECT count(*) FROM pg_locks WHERE NOT granted)::text AS waiting_locks,
        pg_current_wal_lsn()::text AS wal_lsn,
        (SELECT sum(xact_commit) FROM pg_stat_database)::text AS commits,
        (SELECT sum(xact_rollback) FROM pg_stat_database)::text AS rollbacks
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      activeConnections: Number(row.active),
      idleConnections: Number(row.idle),
      totalConnections: Number(row.total),
      waitingLocks: Number(row.waiting_locks),
      walLsn: row.wal_lsn,
      commits: Number(row.commits),
      rollbacks: Number(row.rollbacks),
    };
  } catch {
    return null;
  }
}

export interface CollectorOptions {
  /** e.g. http://localhost:9465/metrics. Omit to skip worker sampling. */
  workerMetricsUrl?: string | undefined;
  /** Read-only monitoring connection string. Omit to skip DB sampling. */
  dbUrl?: string | undefined;
  intervalMs: number;
  /** Per-request scrape timeout, so a stalled scrape cannot stall the benchmark loop. */
  scrapeTimeoutMs?: number;
}

export function startCollector(opts: CollectorOptions): CollectorHandle {
  const workerSamples: WorkerSample[] = [];
  const dbSamples: DbSample[] = [];
  let workerReachable = false;
  let dbReachable = false;
  const scrapeTimeoutMs = opts.scrapeTimeoutMs ?? 2_000;

  const dbPool = opts.dbUrl
    ? new Pool({ connectionString: opts.dbUrl, max: 1, application_name: 'pulse_ingestion_bench_collector' })
    : null;

  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    const atMs = Date.now();
    const tasks: Array<Promise<void>> = [];
    if (opts.workerMetricsUrl) {
      tasks.push(
        sampleWorker(opts.workerMetricsUrl, scrapeTimeoutMs).then((sample) => {
          if (sample) {
            workerReachable = true;
            workerSamples.push({ atMs, ...sample });
          }
        }),
      );
    }
    if (dbPool) {
      tasks.push(
        sampleDb(dbPool).then((sample) => {
          if (sample) {
            dbReachable = true;
            dbSamples.push({ atMs, ...sample });
          }
        }),
      );
    }
    await Promise.all(tasks);
  };

  const timer = setInterval(() => void tick(), opts.intervalMs);
  void tick(); // fire one immediately so a short run still has a sample

  return {
    snapshot() {
      return { workerSamples: [...workerSamples], dbSamples: [...dbSamples] };
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await tick(); // one final sample at stop time
      if (dbPool) await dbPool.end().catch(() => undefined);
      return {
        workerSamples,
        dbSamples,
        sourcesReachable: { worker: workerReachable, db: dbReachable },
      };
    },
  };
}
