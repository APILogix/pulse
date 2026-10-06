/**
 * Enterprise ingestion queue contract (Supabase PGMQ).
 *
 * Single source of truth shared by the HTTP gateway (producer) and the worker
 * process (consumer). Both sides MUST import queue names, payload shapes and
 * priority math from here — never redefine them locally.
 *
 * Architecture:
 *   - One public gateway; internally one pgmq queue per SDK event type
 *     (`ingest_<type>`) so pipelines scale, retry and fail independently.
 *   - Priority calculation preserved for scheduling and telemetry.
 *   - Tenant fairness is enforced worker-side (per-org in-flight budgets in
 *     worker-registry.ts).
 *   - Failed jobs land in `ingest_dlq`, whose worker persists them into
 *     `ingestion_dead_letter_jobs` for ops replay.
 */
import { pgmq, isPgmqQueueAlreadyProvisionedError } from '../../../lib/pgmq.js';
import { logger } from '../../../config/logger.js';
import { SDK_EVENT_TYPES, type SdkEventType } from '../pipeline/event-normalizer.js';

const qLogger = logger.child({ component: 'ingest-queues' });

// ─── Queue names ────────────────────────────────────────────────────────────

export const INGEST_QUEUE_PREFIX = 'ingest_';

export const INGEST_QUEUES: Record<SdkEventType, string> = {
  error: 'ingest_error',
  message: 'ingest_message',
  request: 'ingest_request',
  span: 'ingest_span',
  trace: 'ingest_trace',
  metric: 'ingest_metric',
  log: 'ingest_log',
  profile: 'ingest_profile',
  cron_checkin: 'ingest_cron_checkin',
  replay: 'ingest_replay',
};

export const QUEUE_TO_EVENT_TYPE: ReadonlyMap<string, SdkEventType> = new Map(
  (Object.entries(INGEST_QUEUES) as [SdkEventType, string][]).map(([type, queue]) => [queue, type]),
);

export const ALL_INGEST_QUEUES: readonly string[] = Object.values(INGEST_QUEUES);

/** Shared dead-letter intake queue for every ingest_* queue. */
export const INGEST_DLQ_INTAKE_QUEUE = 'ingest_dlq';

/** Singleton cron queue driving the org/project usage rollup. */
export const INGEST_USAGE_ROLLUP_QUEUE = 'ingest_usage_rollup';

export function ingestQueueFor(eventType: SdkEventType): string {
  return INGEST_QUEUES[eventType] ?? `${INGEST_QUEUE_PREFIX}error`;
}

// ─── Plan-aware priorities ──────────────────────────────────────────────────

export type PlanTier = 'free' | 'starter' | 'growth' | 'business' | 'enterprise';

export const PLAN_TIERS: readonly PlanTier[] = [
  'free',
  'starter',
  'growth',
  'business',
  'enterprise',
];

/** Plan weight dominates priority: a higher tier ALWAYS outranks a lower one. */
export const PLAN_WEIGHT: Record<PlanTier, number> = {
  enterprise: 1000,
  business: 800,
  growth: 600,
  starter: 400,
  free: 200,
};

/** Type urgency breaks ties within a tier: actionable signals first. */
export const TYPE_URGENCY: Record<SdkEventType, number> = {
  error: 100,
  message: 100,
  cron_checkin: 100,
  request: 50,
  span: 50,
  trace: 50,
  log: 30,
  metric: 20,
  profile: 10,
  replay: 10,
};

/**
 * Per-org in-flight budget per worker process, by plan tier.
 */
export const TENANT_INFLIGHT_LIMIT: Record<PlanTier, number> = {
  enterprise: 24,
  business: 16,
  growth: 8,
  starter: 4,
  free: 2,
};

/** Priority boost granted per fairness deferral so aged jobs win eventually. */
export const FAIRNESS_AGE_BOOST = 25;

export function normalizePlanTier(raw: unknown): PlanTier {
  return raw === 'enterprise' || raw === 'business' || raw === 'growth' || raw === 'starter'
    ? raw
    : 'free';
}

export function jobPriority(planTier: PlanTier, eventType: SdkEventType, deferCount = 0): number {
  return PLAN_WEIGHT[planTier] + TYPE_URGENCY[eventType] + deferCount * FAIRNESS_AGE_BOOST;
}

// ─── Payloads ───────────────────────────────────────────────────────────────

export interface IngestJobMetadata {
  /** Gateway batch id (one per HTTP request). */
  batchId: string;
  apiKeyId: string;
  apiKeyName?: string | undefined;
  planTier: PlanTier;
  /** ISO timestamp when the gateway accepted the batch (e2e latency anchor). */
  receivedAt: string;
  /** Normalized environment string supplied by the SDK ingestion envelope. */
  environment: string;
  /** Fairness defer counter (worker-side). */
  deferCount: number;
  /** True when produced by a DLQ/ops replay instead of live traffic. */
  replay?: boolean | undefined;
  projectSlug?: string | undefined;
  projectName?: string | undefined;
  orgSlug?: string | undefined;
  orgName?: string | undefined;
}

export interface IngestJobPayload {
  organizationId: string;
  projectId: string;
  eventType: SdkEventType;
  /** Raw SDK events (unvalidated beyond envelope checks); ≤ chunk size. */
  events: unknown[];
  metadata: IngestJobMetadata;
}

export interface DlqIntakePayload {
  /** Original ingest_* queue the job failed in. */
  sourceQueue: string;
  organizationId: string;
  projectId: string;
  /** Original normalized SDK environment; required for faithful replay. */
  environment: string;
  eventType: SdkEventType | 'unknown';
  payload: unknown;
  failedAt: string;
  error: string;
}

export interface UsageRollupPayload {
  /** Set by the scheduler; informational only (job is a singleton cron). */
  triggeredAt: string;
}

// ─── Queue provisioning ─────────────────────────────────────────────────────

/**
 * Provision all ingestion pgmq queues on Supabase.
 * Idempotent, robust against concurrent multi-process starts, pre-existing queues,
 * and sequence-to-extension membership collisions.
 */
export async function provisionIngestQueues(): Promise<void> {
  const queuesToEnsure = [
    INGEST_DLQ_INTAKE_QUEUE,
    ...ALL_INGEST_QUEUES,
    INGEST_USAGE_ROLLUP_QUEUE,
  ];

  if (typeof pgmq.createQueues === 'function') {
    await pgmq.createQueues(queuesToEnsure, { concurrency: 4 });
    return;
  }

  // Fallback for custom mocks or environments without createQueues
  await pgmq.fetchKnownQueues().catch(() => new Set<string>());

  for (const name of queuesToEnsure) {
    try {
      await pgmq.createQueue(name);
    } catch (err) {
      if (isPgmqQueueAlreadyProvisionedError(err)) {
        continue;
      }
      qLogger.warn({ queue: name, err }, 'Unexpected error provisioning ingest queue');
      throw err;
    }
  }
}

// ─── Enqueue ────────────────────────────────────────────────────────────────

export interface EnqueueResult {
  jobIds: string[];
  enqueuedEvents: number;
  queues: Array<{
    queue: string;
    jobs: number;
    events: number;
    bulk: boolean;
    fallback: boolean;
    durationMs: number;
  }>;
}

/**
 * Enqueue a tenant-scoped batch as one pgmq message per (type, chunk).
 * Uses batch sending with PGMQ for maximum throughput.
 */
export async function enqueueIngestJobs(
  jobs: Array<{ queue: string; payload: IngestJobPayload; priority?: number }>,
): Promise<EnqueueResult> {
  const jobIds: string[] = [];
  let enqueuedEvents = 0;
  const queues: EnqueueResult['queues'] = [];
  if (jobs.length === 0) return { jobIds, enqueuedEvents, queues };

  // Group by queue so we can send batches per queue in a single SQL query
  const byQueue = new Map<string, Array<IngestJobPayload>>();
  for (const job of jobs) {
    const queueName = job.queue.replace(/\./g, '_');
    const list = byQueue.get(queueName) ?? [];
    list.push(job.payload);
    byQueue.set(queueName, list);
  }

  for (const [queue, items] of byQueue) {
    const queueStartedAt = Date.now();
    const queueEvents = items.reduce((n, i) => n + (Array.isArray(i.events) ? i.events.length : 0), 0);

    try {
      const ids = await pgmq.sendBatch(queue, items);
      jobIds.push(...ids);
      enqueuedEvents += queueEvents;
      queues.push({
        queue,
        jobs: items.length,
        events: queueEvents,
        bulk: true,
        fallback: false,
        durationMs: Date.now() - queueStartedAt,
      });
    } catch (err) {
      qLogger.warn({ err, queue }, 'sendBatch failed; falling back to per-message send()');
      for (const item of items) {
        try {
          const id = await pgmq.send(queue, item);
          jobIds.push(id);
          enqueuedEvents += Array.isArray(item.events) ? item.events.length : 0;
        } catch (singleErr) {
          qLogger.error({ err: singleErr, queue }, 'Failed to send individual pgmq message');
        }
      }
      queues.push({
        queue,
        jobs: items.length,
        events: queueEvents,
        bulk: false,
        fallback: true,
        durationMs: Date.now() - queueStartedAt,
      });
    }
  }

  return { jobIds, enqueuedEvents, queues };
}

// ─── Queue depth probe (gateway backpressure) ───────────────────────────────

const DLQ_DEPTH_SQL = `
  SELECT queue, COUNT(*)::int AS n
  FROM ingestion_dead_letter_jobs
  WHERE replayed_at IS NULL
  GROUP BY queue`;

export type EventQueueLifecycleStatus = 'idle' | 'pending' | 'inserting';

export interface EventTypeQueueStatus {
  eventType: SdkEventType;
  queue: string;
  status: EventQueueLifecycleStatus;
  /** Total jobs in the queue table */
  total: number;
  /** Jobs waiting to be picked up by workers */
  pending: number;
  /** Jobs currently leased and actively being inserted */
  inserting: number;
  /** Dead-lettered jobs pending replay */
  failed: number;
  oldestPendingAgeMs: number | null;
}

export interface IngestQueueDepthSnapshot {
  /** Jobs waiting to be picked up across all ingest queues. */
  pending: number;
  /** Runnable jobs ready now. */
  ready: number;
  /** Delayed/deferred jobs. */
  deferred: number;
  /** Active jobs currently leased. */
  active: number;
  /** Failed / dead-lettered jobs in dead letter storage. */
  failed: number;
  deadLettered: number;
  oldestPendingAgeMs: number | null;
  perQueue: Array<{
    queue: string;
    state: string;
    count: number;
    ready: number;
    deferred: number;
    oldestPendingAgeMs: number | null;
  }>;
  perEventType?: Record<SdkEventType, EventTypeQueueStatus>;
  dlqPerQueue: Array<{ queue: string; count: number }>;
}

export function createEmptyQueueDepthSnapshot(): IngestQueueDepthSnapshot {
  const perEventType = {} as Record<SdkEventType, EventTypeQueueStatus>;
  for (const type of SDK_EVENT_TYPES) {
    perEventType[type] = {
      eventType: type,
      queue: INGEST_QUEUES[type],
      status: 'idle',
      total: 0,
      pending: 0,
      inserting: 0,
      failed: 0,
      oldestPendingAgeMs: null,
    };
  }
  return {
    pending: 0,
    ready: 0,
    deferred: 0,
    active: 0,
    failed: 0,
    deadLettered: 0,
    oldestPendingAgeMs: null,
    perQueue: [],
    perEventType,
    dlqPerQueue: [],
  };
}

/**
 * Queue depth probe reading PGMQ telemetry.
 */
export async function ingestQueueDepth(
  pool?: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  },
): Promise<IngestQueueDepthSnapshot> {
  const snap = createEmptyQueueDepthSnapshot();

  try {
    const allMetrics = await pgmq.metricsAll();
    const ingestMetrics = allMetrics.filter(
      (m) => m.queueName.startsWith('ingest_') || m.queueName.startsWith('ingest.'),
    );

    for (const m of ingestMetrics) {
      const pending = m.queueLength;
      const ready = m.queueVisibleLength;
      const active = Math.max(0, pending - ready);
      const oldestAgeMs = m.oldestMsgAgeSec != null ? m.oldestMsgAgeSec * 1000 : null;

      snap.pending += pending;
      snap.ready += ready;
      snap.active += active;
      if (oldestAgeMs != null) {
        snap.oldestPendingAgeMs = Math.max(snap.oldestPendingAgeMs ?? 0, oldestAgeMs);
      }

      snap.perQueue.push({
        queue: m.queueName,
        state: 'ready',
        count: pending,
        ready,
        deferred: Math.max(0, pending - ready),
        oldestPendingAgeMs: oldestAgeMs,
      });

      const matchedType = QUEUE_TO_EVENT_TYPE.get(m.queueName);
      if (matchedType && snap.perEventType) {
        const target = snap.perEventType[matchedType];
        if (target) {
          target.total = pending;
          target.pending = ready;
          target.inserting = active;
          target.oldestPendingAgeMs = oldestAgeMs;
          target.status = active > 0 ? 'inserting' : ready > 0 ? 'pending' : 'idle';
        }
      }
    }

    if (pool) {
      const dlq = await pool.query(DLQ_DEPTH_SQL).catch(() => ({ rows: [] }));
      for (const row of dlq.rows) {
        const count = Number(row.n) || 0;
        snap.deadLettered += count;
        snap.dlqPerQueue.push({ queue: row.queue, count });

        const matchedType = QUEUE_TO_EVENT_TYPE.get(row.queue);
        if (matchedType && snap.perEventType) {
          const target = snap.perEventType[matchedType];
          if (target) {
            target.failed += count;
          }
        }
      }
    }
  } catch (err) {
    qLogger.debug({ err }, 'PGMQ queue depth probe failed; reporting zero depth');
  }

  return snap;
}
