/**
 * Worker observability: in-process metrics registry + a tiny node:http scrape
 * endpoint (Prometheus text format, hand-rolled — plain Maps, no extra deps).
 *
 *   GET /metrics — per-queue counters {jobs_processed, jobs_failed,
 *                  events_received, events_inserted, events_rejected,
 *                  events_deferred}, org in-flight gauges, processing + e2e
 *                  latency {count,sum,max} per type, DLQ intake count, usage
 *                  rollup last-run stats, and a live pg-boss queue-depth probe.
 *   GET /healthz — { uptime, queues } JSON for liveness probes.
 *
 * The server is best-effort: a bind failure logs a warning and the worker
 * keeps running without metrics. The queue-depth probe is cached ~5s so a
 * scrape storm cannot hammer the pgboss.job table.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { env } from '../../../config/env.js';
import {
  ALL_INGEST_QUEUES,
  ingestQueueDepth,
  type IngestQueueDepthSnapshot,
} from '../queue/ingest-queues.js';

const DEPTH_CACHE_MS = 5_000;

interface QueueCounters {
  jobsProcessed: number;
  jobsFailed: number;
  eventsReceived: number;
  eventsInserted: number;
  eventsRejected: number;
  eventsDeferred: number;
}

interface LatencyStat {
  count: number;
  sum: number;
  max: number;
}

export interface RollupRunStats {
  durationMs: number;
  stagingRows: number;
  events: number;
  orgs: number;
  projects: number;
}

function emptyQueueCounters(): QueueCounters {
  return {
    jobsProcessed: 0,
    jobsFailed: 0,
    eventsReceived: 0,
    eventsInserted: 0,
    eventsRejected: 0,
    eventsDeferred: 0,
  };
}

function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * In-process metrics registry. All methods are synchronous and never throw —
 * recording a metric must never break a job.
 */
export class WorkerMetrics {
  private readonly queues = new Map<string, QueueCounters>();
  private readonly processingMs = new Map<string, LatencyStat>();
  private readonly e2eMs = new Map<string, LatencyStat>();
  private readonly orgInFlight = new Map<string, number>();

  // Fairness gate counters (spec: deferredJobs / fairnessProcessed).
  deferredJobs = 0;
  fairnessProcessed = 0;
  dlqIntake = 0;

  rollupRuns = 0;
  rollupFailures = 0;
  rollupLastRunAt: string | null = null;
  rollupLastDurationMs = 0;
  rollupLastStagingRows = 0;
  rollupLastEvents = 0;
  rollupLastOrgs = 0;
  rollupLastProjects = 0;

  private queue(name: string): QueueCounters {
    let q = this.queues.get(name);
    if (!q) {
      q = emptyQueueCounters();
      this.queues.set(name, q);
    }
    return q;
  }

  private observe(map: Map<string, LatencyStat>, key: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    let s = map.get(key);
    if (!s) {
      s = { count: 0, sum: 0, max: 0 };
      map.set(key, s);
    }
    s.count += 1;
    s.sum += ms;
    if (ms > s.max) s.max = ms;
  }

  recordProcessed(
    queue: string,
    type: string,
    eventsReceived: number,
    inserted: number,
    rejected: number,
    processingMs: number,
    e2eMsVal: number | null,
  ): void {
    const q = this.queue(queue);
    q.jobsProcessed += 1;
    q.eventsReceived += eventsReceived;
    q.eventsInserted += inserted;
    q.eventsRejected += rejected;
    this.observe(this.processingMs, type, processingMs);
    if (e2eMsVal != null) this.observe(this.e2eMs, type, e2eMsVal);
  }

  recordFailed(queue: string, eventsReceived: number): void {
    const q = this.queue(queue);
    q.jobsFailed += 1;
    q.eventsReceived += eventsReceived;
  }

  recordDeferred(queue: string, events: number): void {
    this.queue(queue).eventsDeferred += events;
    this.deferredJobs += 1;
  }

  recordFairnessProcessed(): void {
    this.fairnessProcessed += 1;
  }

  recordDlqIntake(count = 1): void {
    this.dlqIntake += count;
  }

  setOrgInFlight(orgId: string, count: number): void {
    if (count <= 0) this.orgInFlight.delete(orgId);
    else this.orgInFlight.set(orgId, count);
  }

  recordRollupSuccess(stats: RollupRunStats): void {
    this.rollupRuns += 1;
    this.rollupLastRunAt = new Date().toISOString();
    this.rollupLastDurationMs = stats.durationMs;
    this.rollupLastStagingRows = stats.stagingRows;
    this.rollupLastEvents = stats.events;
    this.rollupLastOrgs = stats.orgs;
    this.rollupLastProjects = stats.projects;
  }

  recordRollupFailure(durationMs: number): void {
    this.rollupRuns += 1;
    this.rollupFailures += 1;
    this.rollupLastRunAt = new Date().toISOString();
    this.rollupLastDurationMs = durationMs;
  }

  /** Render the Prometheus text exposition format (v0.0.4). */
  render(depth: IngestQueueDepthSnapshot | null): string {
    const out: string[] = [];
    const counter = (name: string, help: string, value: number, labels?: Record<string, string>): void => {
      out.push(`# HELP ${name} ${help}`);
      out.push(`# TYPE ${name} counter`);
      out.push(formatSample(name, value, labels));
    };
    const gauge = (name: string, help: string, value: number, labels?: Record<string, string>): void => {
      out.push(`# HELP ${name} ${help}`);
      out.push(`# TYPE ${name} gauge`);
      out.push(formatSample(name, value, labels));
    };

    const queueMetrics: Array<[keyof QueueCounters, string, string]> = [
      ['jobsProcessed', 'ingest_jobs_processed_total', 'Jobs completed by the ingestion workers.'],
      ['jobsFailed', 'ingest_jobs_failed_total', 'Jobs that failed (pg-boss retries them).'],
      ['eventsReceived', 'ingest_events_received_total', 'Raw events entering the processing pipeline.'],
      ['eventsInserted', 'ingest_events_inserted_total', 'Events actually persisted (duplicates excluded).'],
      ['eventsRejected', 'ingest_events_rejected_total', 'Events rejected by validation (routed to DLQ).'],
      ['eventsDeferred', 'ingest_events_deferred_total', 'Events deferred by the tenant-fairness gate.'],
    ];
    const allQueues = new Set<string>([...ALL_INGEST_QUEUES, ...this.queues.keys()]);
    for (const [key, name, help] of queueMetrics) {
      out.push(`# HELP ${name} ${help}`);
      out.push(`# TYPE ${name} counter`);
      for (const q of allQueues) {
        out.push(formatSample(name, this.queue(q)[key], { queue: q }));
      }
    }

    counter('ingest_fairness_deferred_jobs_total', 'Jobs deferred by the tenant-fairness gate.', this.deferredJobs);
    counter('ingest_fairness_processed_jobs_total', 'Jobs admitted by the tenant-fairness gate and processed.', this.fairnessProcessed);
    counter('ingest_dlq_intake_total', 'Dead-lettered jobs persisted to ingestion_dead_letter_jobs.', this.dlqIntake);

    out.push('# HELP ingest_org_inflight_jobs Jobs currently being processed per organization (per process).');
    out.push('# TYPE ingest_org_inflight_jobs gauge');
    for (const [orgId, n] of this.orgInFlight) {
      out.push(formatSample('ingest_org_inflight_jobs', n, { org_id: orgId }));
    }

    const latency = (name: string, help: string, map: Map<string, LatencyStat>): void => {
      for (const suffix of ['count', 'sum', 'max'] as const) {
        out.push(`# HELP ${name}_${suffix} ${help} (${suffix}).`);
        out.push(`# TYPE ${name}_${suffix} ${suffix === 'max' ? 'gauge' : 'counter'}`);
        for (const [type, s] of map) {
          out.push(formatSample(`${name}_${suffix}`, s[suffix], { type }));
        }
      }
    };
    latency('ingest_processing_latency_ms', 'Worker-side job processing latency', this.processingMs);
    latency('ingest_e2e_latency_ms', 'End-to-end latency (now minus gateway receivedAt)', this.e2eMs);

    counter('ingest_rollup_runs_total', 'Usage rollup executions.', this.rollupRuns);
    counter('ingest_rollup_failures_total', 'Usage rollup executions that failed (transaction rolled back).', this.rollupFailures);
    gauge('ingest_rollup_last_duration_ms', 'Duration of the last usage rollup run.', this.rollupLastDurationMs);
    gauge('ingest_rollup_last_staging_rows', 'billing:% staging rows consumed by the last rollup.', this.rollupLastStagingRows);
    gauge('ingest_rollup_last_events', 'Events rolled up by the last usage rollup.', this.rollupLastEvents);
    gauge('ingest_rollup_last_orgs', 'Organizations updated by the last usage rollup.', this.rollupLastOrgs);
    gauge('ingest_rollup_last_projects', 'Org/project scopes updated by the last usage rollup.', this.rollupLastProjects);
    if (this.rollupLastRunAt) {
      gauge(
        'ingest_rollup_last_run_timestamp_seconds',
        'Wall clock time of the last usage rollup run (unix seconds).',
        Math.floor(Date.parse(this.rollupLastRunAt) / 1000),
      );
    }

    if (depth) {
      gauge('ingest_queue_depth_pending', 'Jobs waiting to be picked up (created + retry).', depth.pending);
      gauge('ingest_queue_depth_active', 'Jobs currently being processed.', depth.active);
      gauge('ingest_queue_depth_failed', 'Failed jobs (pre-dead-letter).', depth.failed);
      out.push('# HELP ingest_queue_depth_jobs Jobs per queue and state.');
      out.push('# TYPE ingest_queue_depth_jobs gauge');
      for (const row of depth.perQueue) {
        out.push(formatSample('ingest_queue_depth_jobs', row.count, { queue: row.queue, state: row.state }));
      }
    }

    out.push('');
    return out.join('\n');
  }
}

function formatSample(name: string, value: number, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return `${name} ${value}`;
  const inner = Object.entries(labels)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(',');
  return `${name}{${inner}} ${value}`;
}

/**
 * Tiny HTTP server exposing /metrics and /healthz on
 * env.INGESTION_WORKER_METRICS_PORT. Bind failures are logged as warnings and
 * never crash the worker.
 */
export class MetricsServer {
  private server: Server | null = null;
  private depthCache: { at: number; snap: IngestQueueDepthSnapshot } | null = null;

  constructor(
    private readonly metrics: WorkerMetrics,
    private readonly pool: Pool,
    private readonly log: Logger,
  ) {}

  start(): void {
    try {
      this.server = createServer((req, res) => void this.handle(req, res));
      this.server.on('error', (err) => {
        this.log.warn({ err, port: env.INGESTION_WORKER_METRICS_PORT }, 'metrics server error — continuing without metrics');
      });
      this.server.listen(env.INGESTION_WORKER_METRICS_PORT, '0.0.0.0', () => {
        this.log.info({ port: env.INGESTION_WORKER_METRICS_PORT }, 'metrics server listening');
      });
    } catch (err) {
      this.log.warn({ err }, 'metrics server failed to start — continuing without metrics');
      this.server = null;
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && path === '/metrics') {
        const depth = await this.depthSnapshot();
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(this.metrics.render(depth));
        return;
      }
      if (req.method === 'GET' && path === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), queues: ALL_INGEST_QUEUES }));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    } catch (err) {
      this.log.warn({ err }, 'metrics request failed');
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('internal error');
    }
  }

  private async depthSnapshot(): Promise<IngestQueueDepthSnapshot | null> {
    if (this.depthCache && Date.now() - this.depthCache.at < DEPTH_CACHE_MS) {
      return this.depthCache.snap;
    }
    const snap = await ingestQueueDepth(this.pool).catch(() => null);
    if (snap) this.depthCache = { at: Date.now(), snap };
    return snap;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    // Drop idle keep-alive sockets so close() cannot hang on them (Node 18.2+).
    const loose = server as unknown as {
      closeAllConnections?: () => void;
      closeIdleConnections?: () => void;
    };
    loose.closeAllConnections?.();
    loose.closeIdleConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
