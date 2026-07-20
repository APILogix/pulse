/**
 * Ingestion business service — thin accept-and-enqueue gateway (pg-boss).
 *
 * Request-path flow (fast, no heavy work):
 *   1. Envelope checks (object / apiKey / non-empty events / batch cap).
 *   2. Resolve project from the API key (LRU cache -> Postgres fallback),
 *      including billing plan tier and org-wide rate limits.
 *   3. Enforce project status, key permissions, project + org rate limits,
 *      and a cached org quota pre-check.
 *   4. Plan-aware backpressure shedding driven by the ingest.* queue depth.
 *   5. BASIC per-event validation only (object, known SDK type, size cap) —
 *      full Zod normalization runs worker-side, never here.
 *   6. Chunk accepted events per type and enqueue ONE pg-boss job per
 *      (type, chunk) via the shared contract in queue/ingest-queues.ts.
 *   7. Return 202-style accept/reject counts.
 *
 * There is NO in-memory buffering, NO BullMQ, and NO PgQueue on this path.
 * Durability is the pg-boss job row in Postgres: once enqueueIngestJobs()
 * resolves, events survive a crash of any process. Normalization and
 * persistence into the typed telemetry tables happen asynchronously in the
 * worker processes.
 *
 * Hardening notes:
 *   - Rate limiters are sweeping, atomic, bounded token-buckets (no Map
 *     leak, no race window between read and increment).
 *   - Quota pre-check is cached (TTL INGESTION_QUOTA_CACHE_TTL_MS) and
 *     fail-open: a missing row or DB error never blocks ingestion.
 *   - Queue provisioning runs once per process behind a module-level
 *     promise; createQueue is idempotent so multi-process boot is safe.
 */
import { createHash, randomUUID } from 'crypto';
import type { Pool } from 'pg';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { apiKeyCache, type CachedProjectConfig } from '../../config/lrucashe.js';
import { PostgresWriter } from './postgress.writter.js';
import { IngestionRateLimiter } from './rate-limiter.js';
import { UsageCounter } from './usage/usage-counter.js';
import { SDK_EVENT_TYPES, type SdkEventType } from './pipeline/event-normalizer.js';
import {
  enqueueIngestJobs,
  ingestQueueDepth,
  ingestQueueFor,
  jobPriority,
  normalizePlanTier,
  provisionIngestQueues,
  PLAN_WEIGHT,
  TYPE_URGENCY,
  type IngestJobMetadata,
  type IngestJobPayload,
  type IngestQueueDepthSnapshot,
  type PlanTier,
} from './queue/ingest-queues.js';
import type {
  IngestRequest,
  IngestResponse,
  ErrorEventListQuery,
  ErrorEventListResult,
  ErrorEventRecord,
  NormalizedErrorEventListQuery,
  ReplayRequest,
  HealthStatus,
  SDKInitResponse,
} from './types.js';

const svcLogger = logger.child({ component: 'ingestion-service' });

function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

const SDK_EVENT_TYPE_SET: ReadonlySet<string> = new Set<string>(SDK_EVENT_TYPES);

/** Per-event serialized size cap at the gateway (basic envelope guard). */
const MAX_EVENT_BYTES = 256 * 1024;

/** Bound on the quota pre-check cache so it cannot grow without limit. */
const QUOTA_CACHE_MAX_ENTRIES = 10_000;

// ── One-time queue provisioning ─────────────────────────────────────────────
// pg-boss v12 requires queues to exist before send/insert. createQueue is
// idempotent, so the first request (or service construction) provisions every
// ingest.* queue exactly once per process; races across processes are harmless.
let provisioningPromise: Promise<void> | null = null;

function ensureIngestQueuesProvisioned(): Promise<void> {
  if (!provisioningPromise) {
    provisioningPromise = provisionIngestQueues().catch((err) => {
      provisioningPromise = null; // allow retry on the next request
      svcLogger.error({ err }, 'ingest queue provisioning failed');
    });
  }
  return provisioningPromise;
}

interface BackpressureConfig {
  readonly highWater: number;
  readonly criticalWater: number;
}

interface ServiceConfig {
  maxBatchSize: number;
  defaultRateLimitPerSecond: number;
  defaultRateLimitPerMinute: number;
  /** Override defaults via env without touching code. */
  backpressure?: BackpressureConfig;
  replayMaxEvents?: number;
  jobChunkSize?: number;
}

interface ResolvedProject {
  id: string;
  orgId: string;
  environment: string;
  rateLimitPerSecond: number;
  rateLimitPerMinute: number;
  isActive: boolean;
  apiKeyId: string;
  permissions: string[];
  allowedEndpoints: string[];
  blockedEndpoints: string[];
  planTier: PlanTier;
  orgRateLimitPerSecond: number;
  orgRateLimitPerMinute: number;
}

interface QuotaCacheEntry {
  eventsUsed: number;
  eventLimit: number;
  at: number;
}

interface DlqRow {
  id: string;
  queue: string;
  job_type: string;
  org_id: string | null;
  project_id: string | null;
  payload: unknown;
}

const DEFAULT_BACKPRESSURE: BackpressureConfig = {
  highWater: env.INGESTION_BACKPRESSURE_HIGH_WATER,
  criticalWater: env.INGESTION_BACKPRESSURE_CRITICAL_WATER,
};

export class IngestionService {
  private readonly rateLimiter: IngestionRateLimiter;
  private readonly orgRateLimiter: IngestionRateLimiter;
  private readonly usage: UsageCounter;
  private readonly backpressure: BackpressureConfig;
  private readonly replayMaxEvents: number;
  private readonly maxBatchSize: number;
  private readonly jobChunkSize: number;
  private readonly defaultRatePerSecond: number;
  private readonly defaultRatePerMinute: number;

  // Cached queue-depth probe so request-path backpressure stays O(1): the
  // grouped scan on pgboss.job runs at most once per second per process.
  private cachedDepth: IngestQueueDepthSnapshot = {
    pending: 0,
    active: 0,
    failed: 0,
    perQueue: [],
  };
  private cachedDepthAt = 0;

  // Cached org quota reads (organization_usage_current_period), fail-open.
  private readonly quotaCache = new Map<string, QuotaCacheEntry>();
  private readonly quotaCacheTtlMs = env.INGESTION_QUOTA_CACHE_TTL_MS;

  constructor(
    private readonly pool: Pool,
    private readonly writer: PostgresWriter,
    config: ServiceConfig,
  ) {
    this.maxBatchSize = config.maxBatchSize;
    this.defaultRatePerSecond = config.defaultRateLimitPerSecond;
    this.defaultRatePerMinute = config.defaultRateLimitPerMinute;
    this.backpressure = config.backpressure ?? DEFAULT_BACKPRESSURE;
    this.replayMaxEvents = config.replayMaxEvents ?? env.INGESTION_REPLAY_MAX_EVENTS;
    this.jobChunkSize = config.jobChunkSize ?? env.INGESTION_JOB_CHUNK_SIZE;
    this.rateLimiter = new IngestionRateLimiter({
      ttlMs: env.INGESTION_RATE_BUCKET_TTL_MS,
      sweepIntervalMs: env.INGESTION_RATE_BUCKET_SWEEP_MS,
    });
    this.orgRateLimiter = new IngestionRateLimiter({
      ttlMs: env.INGESTION_RATE_BUCKET_TTL_MS,
      sweepIntervalMs: env.INGESTION_RATE_BUCKET_SWEEP_MS,
    });
    // API-tier usage counter. Tier-1 (memory) + Tier-2 (UNLOGGED staging) only;
    // the worker tier drives the staging->durable rollup so the many API
    // cluster processes don't all contend on flush_usage_counters().
    this.usage = new UsageCounter(pool, svcLogger, {
      flushIntervalMs: env.INGESTION_USAGE_FLUSH_MS,
      bufferLimit: env.INGESTION_USAGE_BUFFER_LIMIT,
      driveRollup: false,
    });
    this.usage.start();

    // Warm provisioning at boot (pgboss.start() precedes module registration
    // in main.ts); the request path also awaits the same promise lazily.
    void ensureIngestQueuesProvisioned();
  }

  // ── Project resolution (LRU only; Postgres fallback) ──────────────────────
  private async resolveProject(apiKey: string): Promise<ResolvedProject | null> {
    const keyHash = hashApiKey(apiKey);

    const cached = apiKeyCache.get(keyHash) as CachedProjectConfig | undefined;
    if (cached) {
      return {
        id: cached.id,
        orgId: cached.orgId,
        environment: cached.environment,
        rateLimitPerSecond: cached.rateLimitPerSecond,
        rateLimitPerMinute: cached.rateLimitPerMinute,
        isActive: cached.isActive,
        apiKeyId: cached.apiKeyId,
        permissions: cached.permissions ?? [],
        allowedEndpoints: cached.allowedEndpoints ?? ['*'],
        blockedEndpoints: cached.blockedEndpoints ?? [],
        planTier: normalizePlanTier(cached.planTier),
        orgRateLimitPerSecond:
          cached.orgRateLimitPerSecond ?? env.INGESTION_ORG_RATE_LIMIT_PER_SECOND,
        orgRateLimitPerMinute:
          cached.orgRateLimitPerMinute ?? env.INGESTION_ORG_RATE_LIMIT_PER_MINUTE,
      };
    }

    const auth = await this.writer.getProjectByApiKeyHash(keyHash);
    if (!auth) return null;

    const resolved: ResolvedProject = {
      id: auth.projectId,
      orgId: auth.orgId,
      environment: auth.environment,
      rateLimitPerSecond: auth.rateLimitPerSecond ?? this.defaultRatePerSecond,
      rateLimitPerMinute: auth.rateLimitPerMinute ?? this.defaultRatePerMinute,
      isActive: auth.isActive && auth.projectStatus === 'active',
      apiKeyId: auth.apiKeyId,
      permissions: auth.permissions,
      allowedEndpoints: auth.allowedEndpoints.length ? auth.allowedEndpoints : ['*'],
      blockedEndpoints: auth.blockedEndpoints,
      planTier: normalizePlanTier(auth.planTier),
      orgRateLimitPerSecond:
        auth.orgRateLimitPerSecond ?? env.INGESTION_ORG_RATE_LIMIT_PER_SECOND,
      orgRateLimitPerMinute:
        auth.orgRateLimitPerMinute ?? env.INGESTION_ORG_RATE_LIMIT_PER_MINUTE,
    };

    apiKeyCache.set(keyHash, {
      id: resolved.id,
      orgId: resolved.orgId,
      name: auth.projectName,
      environment: resolved.environment,
      rateLimitPerSecond: resolved.rateLimitPerSecond,
      rateLimitPerMinute: resolved.rateLimitPerMinute,
      allowedEventTypes: ['request', 'error', 'log', 'metric', 'custom'],
      permissions: resolved.permissions,
      allowedEndpoints: resolved.allowedEndpoints,
      blockedEndpoints: resolved.blockedEndpoints,
      isActive: resolved.isActive,
      apiKeyId: resolved.apiKeyId,
      planTier: resolved.planTier,
      orgRateLimitPerSecond: resolved.orgRateLimitPerSecond,
      orgRateLimitPerMinute: resolved.orgRateLimitPerMinute,
    });
    // Fire-and-forget: never block ingestion on a last_used update.
    this.writer
      .updateApiKeyLastUsed(auth.apiKeyId)
      .catch((err) => svcLogger.debug({ err }, 'updateApiKeyLastUsed failed'));
    return resolved;
  }

  /** Cached queue-depth probe (refreshed at most every 1s). */
  private async queueDepth(): Promise<IngestQueueDepthSnapshot> {
    const now = Date.now();
    if (now - this.cachedDepthAt > 1000) {
      // ingestQueueDepth swallows probe errors and reports zeros; that is the
      // desired fail-open behaviour for a transient DB error (never shed on a
      // probe failure — keep the last good value only when the probe itself
      // throws, which today it does not).
      this.cachedDepth = await ingestQueueDepth(this.pool);
      this.cachedDepthAt = now;
    }
    return this.cachedDepth;
  }

  /**
   * Plan-aware shedding. At high water we shed anything below the business
   * tier floor (PLAN_WEIGHT.business + top urgency), so free/starter/growth
   * traffic sheds first. At critical water only business/enterprise batches
   * of top-urgency types (error / message / cron_checkin) pass.
   */
  private shouldShed(depth: number, planTier: PlanTier, type: SdkEventType): boolean {
    if (depth >= this.backpressure.criticalWater) {
      const topTier = planTier === 'business' || planTier === 'enterprise';
      return !(topTier && TYPE_URGENCY[type] === 100);
    }
    if (depth >= this.backpressure.highWater) {
      return PLAN_WEIGHT[planTier] + TYPE_URGENCY[type] < PLAN_WEIGHT.business + 100;
    }
    return false;
  }

  /**
   * Cached quota pre-check against organization_usage_current_period.
   * Fail-open by design: a missing row or a DB error allows the batch
   * (authoritative enforcement happens worker-side / in billing rollups).
   */
  private async assertQuotaAvailable(orgId: string): Promise<void> {
    const now = Date.now();
    let entry = this.quotaCache.get(orgId);
    if (!entry || now - entry.at > this.quotaCacheTtlMs) {
      try {
        const r = await this.pool.query<{
          events_used: string;
          event_limit: string;
        }>(
          `SELECT events_used, event_limit
             FROM organization_usage_current_period
            WHERE organization_id = $1`,
          [orgId],
        );
        const row = r.rows[0];
        entry = row
          ? {
              eventsUsed: Number(row.events_used) || 0,
              eventLimit: Number(row.event_limit) || 0,
              at: now,
            }
          : { eventsUsed: 0, eventLimit: 0, at: now };
        if (this.quotaCache.size >= QUOTA_CACHE_MAX_ENTRIES) {
          // Map iterates in insertion order: drop the oldest entry first.
          const oldest = this.quotaCache.keys().next();
          if (!oldest.done) this.quotaCache.delete(oldest.value);
        }
        this.quotaCache.set(orgId, entry);
      } catch (err) {
        svcLogger.debug({ err, orgId }, 'quota pre-check failed; allowing (fail-open)');
        return;
      }
    }
    if (entry.eventLimit > 0 && entry.eventsUsed >= entry.eventLimit) {
      throw new Error('QUOTA_EXCEEDED');
    }
  }

  // ── SDK init handshake ────────────────────────────────────────────────────
  async initializeSdk(apiKey: string): Promise<SDKInitResponse> {
    const project = await this.resolveProject(apiKey);
    if (!project) throw new Error('INVALID_API_KEY');
    if (!project.isActive) throw new Error('PROJECT_INACTIVE');

    return {
      success: true,
      projectId: project.id,
      config: { samplingRate: 1, enableErrors: true, enablePerformance: true },
      ingestion: {
        endpoint: env.INGESTION_ENDPOINT ?? 'http://127.0.0.1:3000/api/v1/ingest',
        batchSize: 50,
        flushInterval: 5000,
        maxQueueSize: 20000,
      },
    };
  }

  // ── Ingestion entrypoints ─────────────────────────────────────────────────
  async ingestBatch(req: IngestRequest, apiKey: string): Promise<IngestResponse> {
    return this.processIngest(req, null, apiKey);
  }

  async ingestRequests(req: IngestRequest, apiKey: string): Promise<IngestResponse> {
    return this.processIngest(req, 'request', apiKey);
  }
  async ingestErrors(req: IngestRequest, apiKey: string): Promise<IngestResponse> {
    return this.processIngest(req, 'error', apiKey);
  }
  async ingestLogs(req: IngestRequest, apiKey: string): Promise<IngestResponse> {
    return this.processIngest(req, 'log', apiKey);
  }
  async ingestMetrics(req: IngestRequest, apiKey: string): Promise<IngestResponse> {
    return this.processIngest(req, 'metric', apiKey);
  }

  /**
   * Central pipeline — a thin accept-and-enqueue path. `expectedType` (when
   * set) enforces a typed route: every event must match it or be rejected.
   */
  private async processIngest(
    req: IngestRequest,
    expectedType: SdkEventType | null,
    apiKey: string,
  ): Promise<IngestResponse> {
    // 1. Envelope checks.
    if (!req || typeof req !== 'object') throw new Error('INVALID_REQUEST');
    const { events } = req;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error('INVALID_API_KEY');
    }
    if (!Array.isArray(events) || events.length === 0) throw new Error('EMPTY_BATCH');
    if (events.length > this.maxBatchSize) throw new Error('BATCH_TOO_LARGE');

    // 2. Project resolution (+ plan tier, org rate limits).
    const project = await this.resolveProject(apiKey);
    if (!project) throw new Error('INVALID_API_KEY');
    if (!project.isActive) throw new Error('PROJECT_INACTIVE');

    // 3. Key permissions.
    this.assertKeyCanUseEndpoint(project, expectedType);

    // 4. Rate limits: project-scoped AND org-wide (noisy-neighbor guard).
    const decision = this.rateLimiter.tryConsume(
      project.id,
      project.rateLimitPerSecond,
      project.rateLimitPerMinute,
      events.length,
    );
    if (!decision.allowed) throw new Error('RATE_LIMIT_EXCEEDED');
    const orgDecision = this.orgRateLimiter.tryConsume(
      project.orgId,
      project.orgRateLimitPerSecond,
      project.orgRateLimitPerMinute,
      events.length,
    );
    if (!orgDecision.allowed) throw new Error('RATE_LIMIT_EXCEEDED');

    // 5. Quota pre-check (cached, fail-open).
    await this.assertQuotaAvailable(project.orgId);

    // Queues must exist before the first insert; no-op after first success.
    await ensureIngestQueuesProvisioned();

    // 6. Backpressure snapshot (cached at 1s granularity).
    const depth = await this.queueDepth();

    const batchId = randomUUID();
    const receivedAt = new Date().toISOString();
    const errors: Array<{ eventId: string; reason: string }> = [];
    const acceptedByType = new Map<SdkEventType, unknown[]>();
    let shed = 0;

    // 7. Per-event BASIC validation only. Full Zod normalization runs in the
    // workers; the gateway must stay cheap enough to absorb floods.
    for (const raw of events as unknown[]) {
      const eventId = this.extractEventId(raw);

      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        errors.push({ eventId, reason: 'event_not_object' });
        continue;
      }
      const type = (raw as { type?: unknown }).type;
      if (typeof type !== 'string' || !SDK_EVENT_TYPE_SET.has(type)) {
        errors.push({ eventId, reason: `unknown event type: ${String(type)}` });
        continue;
      }
      const eventType = type as SdkEventType;

      if (expectedType && eventType !== expectedType) {
        errors.push({ eventId, reason: `expected '${expectedType}', got '${eventType}'` });
        continue;
      }

      let serialized: string;
      try {
        serialized = JSON.stringify(raw);
      } catch {
        errors.push({ eventId, reason: 'event_not_serializable' });
        continue;
      }
      if (Buffer.byteLength(serialized) > MAX_EVENT_BYTES) {
        errors.push({ eventId, reason: 'event_too_large' });
        continue;
      }

      if (this.shouldShed(depth.pending, project.planTier, eventType)) {
        shed++;
        errors.push({ eventId, reason: 'shed_backpressure' });
        continue;
      }

      const list = acceptedByType.get(eventType) ?? [];
      list.push(raw);
      acceptedByType.set(eventType, list);
    }

    // 8. Chunk per type and enqueue one pg-boss job per (type, chunk).
    let accepted = 0;
    if (acceptedByType.size > 0) {
      const jobs = this.buildJobs({
        organizationId: project.orgId,
        projectId: project.id,
        apiKeyId: project.apiKeyId,
        planTier: project.planTier,
        environment: project.environment,
        batchId,
        receivedAt,
        byType: acceptedByType,
      });
      const result = await enqueueIngestJobs(jobs);
      accepted = result.enqueuedEvents;
      if (accepted < jobs.reduce((n, j) => n + j.payload.events.length, 0)) {
        svcLogger.warn(
          { projectId: project.id, batchId, accepted },
          'enqueueIngestJobs accepted fewer events than submitted',
        );
      }
    }

    if (shed > 0) {
      svcLogger.warn(
        {
          projectId: project.id,
          planTier: project.planTier,
          shed,
          depth: depth.pending,
          highWater: this.backpressure.highWater,
        },
        'Backpressure shedding active',
      );
    }

    // Fire-and-forget usage accounting at ingest time (Tier-1, memory only —
    // never awaited, never throws). Captures the request-path view of usage
    // (accepted/rejected/shed) distinct from the worker's persisted count.
    this.usage.increment(project.id, project.orgId, 'events_received', events.length);
    if (accepted > 0) this.usage.increment(project.id, project.orgId, 'events_accepted', accepted);
    if (errors.length > 0) {
      this.usage.increment(project.id, project.orgId, 'events_rejected', errors.length);
    }
    if (shed > 0) this.usage.increment(project.id, project.orgId, 'events_shed', shed);

    const nextMinuteMs = (Math.floor(Date.now() / 60_000) + 1) * 60_000;

    const response: IngestResponse = {
      success: true,
      accepted,
      rejected: errors.length,
      batchId,
      limits: {
        remaining: decision.perMinuteRemaining,
        resetAt: nextMinuteMs,
      },
    };
    if (errors.length > 0) response.errors = errors;
    return response;
  }

  /**
   * Build one pg-boss job per (event type, chunk of <= jobChunkSize events).
   * Events are carried RAW (un-normalized) — normalization is worker-side.
   */
  private buildJobs(params: {
    organizationId: string;
    projectId: string;
    apiKeyId: string;
    planTier: PlanTier;
    environment: string;
    batchId: string;
    receivedAt: string;
    replay?: boolean;
    byType: Map<SdkEventType, unknown[]>;
  }): Array<{ queue: string; payload: IngestJobPayload; priority: number }> {
    const jobs: Array<{ queue: string; payload: IngestJobPayload; priority: number }> = [];
    for (const [type, list] of params.byType) {
      for (let i = 0; i < list.length; i += this.jobChunkSize) {
        const metadata: IngestJobMetadata = {
          batchId: params.batchId,
          apiKeyId: params.apiKeyId,
          planTier: params.planTier,
          receivedAt: params.receivedAt,
          environment: params.environment,
          deferCount: 0,
          ...(params.replay ? { replay: true } : {}),
        };
        jobs.push({
          queue: ingestQueueFor(type),
          payload: {
            organizationId: params.organizationId,
            projectId: params.projectId,
            eventType: type,
            events: list.slice(i, i + this.jobChunkSize),
            metadata,
          },
          priority: jobPriority(params.planTier, type),
        });
      }
    }
    return jobs;
  }

  /** Best-effort stable id for a single event in a batch. */
  private extractEventId(raw: unknown): string {
    if (typeof raw !== 'object' || raw === null) return randomUUID();
    const r = raw as { eventId?: unknown; requestId?: unknown };
    if (typeof r.eventId === 'string' && r.eventId.length > 0 && r.eventId.length <= 128) {
      return r.eventId;
    }
    if (typeof r.requestId === 'string' && r.requestId.length > 0 && r.requestId.length <= 128) {
      return r.requestId;
    }
    return randomUUID();
  }

  private assertKeyCanUseEndpoint(project: ResolvedProject, expectedType: SdkEventType | null): void {
    if (!project.permissions.includes('ingest:write')) {
      throw new Error('API_KEY_PERMISSION_DENIED');
    }

    const endpoint = expectedType ? `ingest:${expectedType}` : 'ingest:batch';
    const allowed = project.allowedEndpoints.length === 0 ||
      project.allowedEndpoints.includes('*') ||
      project.allowedEndpoints.includes(endpoint);
    const blocked = project.blockedEndpoints.includes('*') ||
      project.blockedEndpoints.includes(endpoint);

    if (!allowed || blocked) {
      throw new Error('API_KEY_ENDPOINT_DENIED');
    }
  }

  // ── Health / observability ────────────────────────────────────────────────
  async getHealth(): Promise<HealthStatus> {
    const database = await this.writer.healthCheck();
    let queue = false;
    try {
      // The gateway's only queue dependency is the pg-boss job table.
      await this.pool.query('SELECT 1 FROM pgboss.job LIMIT 1');
      queue = true;
    } catch {
      queue = false;
    }
    // The ingestion module does not depend on Redis. The legacy `redis` field
    // is kept for backwards-compatible response shape but always reports the
    // truth: this subsystem is Postgres-only.
    const services: HealthStatus['services'] = {
      redis: false, // ingestion does not use redis; reported honestly.
      database,
      queue,
    };
    const status: HealthStatus['status'] = database && queue ? 'healthy' : 'degraded';
    return {
      status,
      services,
      timestamp: new Date().toISOString(),
    };
  }

  async getIngestionHealth(): Promise<unknown> {
    const depth = await ingestQueueDepth(this.pool);
    let deadLettered = 0;
    try {
      const r = await this.pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n
           FROM ingestion_dead_letter_jobs
          WHERE replayed_at IS NULL`,
      );
      deadLettered = Number(r.rows[0]?.n ?? 0) || 0;
    } catch {
      // DLQ table may not exist yet on a fresh install; degrade to zero.
      deadLettered = 0;
    }
    return {
      queue: 'ingest.*',
      jobs: {
        waiting: depth.pending,
        active: depth.active,
        failed: depth.failed,
        deadLettered,
      },
      perQueue: depth.perQueue,
      rateLimiterEntries: this.rateLimiter.size(),
      orgRateLimiterEntries: this.orgRateLimiter.size(),
      quotaCacheEntries: this.quotaCache.size,
      backpressure: {
        highWater: this.backpressure.highWater,
        criticalWater: this.backpressure.criticalWater,
      },
      timestamp: new Date().toISOString(),
    };
  }

  async getLimits(apiKey: string) {
    const project = await this.resolveProject(apiKey);
    if (!project) throw new Error('INVALID_API_KEY');
    return {
      perSecond: project.rateLimitPerSecond,
      perMinute: project.rateLimitPerMinute,
      maxBatchSize: this.maxBatchSize,
      orgPerSecond: project.orgRateLimitPerSecond,
      orgPerMinute: project.orgRateLimitPerMinute,
      planTier: project.planTier,
    };
  }

  // ── Dead-letter management (Postgres-backed) ──────────────────────────────
  /**
   * Paginated listing of dead-lettered jobs. Uses bounded offset/limit with
   * defensive validation: callers may pass arbitrary integers; we clamp them
   * before they touch the SQL.
   */
  async getDLQJobs(offset = 0, limit = 100): Promise<unknown[]> {
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? Math.trunc(offset) : 0;
    const safeLimit =
      Number.isFinite(limit) && limit > 0 ? Math.min(Math.trunc(limit), 1000) : 100;

    const r = await this.pool.query(
      `SELECT id, original_job_id, queue, job_type, project_id, org_id,
              attempts, last_error, failed_at, replayed_at
       FROM ingestion_dead_letter_jobs
       ORDER BY failed_at DESC
       OFFSET $1 LIMIT $2`,
      [safeOffset, safeLimit],
    );
    return r.rows;
  }

  /**
   * Re-enqueue one dead-lettered job through the pg-boss ingest queues. The
   * DLQ intake worker stores the original IngestJobPayload in the payload
   * column, so we reconstruct it, flag metadata.replay, and re-enqueue with
   * the same plan-aware priority math as live traffic.
   */
  async reprocessDLQJob(jobId: string, replayedBy?: string): Promise<void> {
    if (typeof jobId !== 'string' || jobId.length === 0) {
      throw new Error('JOB_NOT_FOUND');
    }
    const r = await this.pool.query<DlqRow>(
      `SELECT id, queue, job_type, org_id, project_id, payload
         FROM ingestion_dead_letter_jobs
        WHERE id = $1
          AND replayed_at IS NULL`,
      [jobId],
    );
    const row = r.rows[0];
    if (!row) throw new Error('JOB_NOT_FOUND');

    const payload = this.dlqRowToJobPayload(row);
    if (!payload) throw new Error('JOB_NOT_FOUND');

    await ensureIngestQueuesProvisioned();
    await enqueueIngestJobs([
      {
        queue: ingestQueueFor(payload.eventType),
        payload,
        priority: jobPriority(payload.metadata.planTier, payload.eventType),
      },
    ]);
    await this.pool.query(
      `UPDATE ingestion_dead_letter_jobs
          SET replayed_at = NOW(),
              replayed_by = $2
        WHERE id = $1`,
      [jobId, replayedBy ?? null],
    );
  }

  /**
   * Rebuild an IngestJobPayload from a DLQ row. Primary shape: the stored
   * payload IS the original IngestJobPayload (worker-side DLQ intake stores
   * the failed job's data verbatim). Fallback: older rows may only carry a
   * bare event (or an array of events), in which case we wrap them using the
   * DLQ row's own org/project/type columns.
   */
  private dlqRowToJobPayload(row: DlqRow): IngestJobPayload | null {
    const stored = row.payload as Partial<IngestJobPayload> | null;
    if (
      stored &&
      typeof stored === 'object' &&
      !Array.isArray(stored) &&
      typeof stored.organizationId === 'string' &&
      typeof stored.projectId === 'string' &&
      typeof stored.eventType === 'string' &&
      SDK_EVENT_TYPE_SET.has(stored.eventType) &&
      Array.isArray(stored.events)
    ) {
      const meta = (stored.metadata ?? {}) as Partial<IngestJobMetadata>;
      const planTier = normalizePlanTier(meta.planTier);
      return {
        organizationId: stored.organizationId,
        projectId: stored.projectId,
        eventType: stored.eventType as SdkEventType,
        events: stored.events,
        metadata: {
          batchId: typeof meta.batchId === 'string' ? meta.batchId : randomUUID(),
          apiKeyId: typeof meta.apiKeyId === 'string' ? meta.apiKeyId : '',
          planTier,
          receivedAt: new Date().toISOString(),
          environment: typeof meta.environment === 'string' ? meta.environment : 'unknown',
          deferCount: 0,
          replay: true,
        },
      };
    }

    // Validation-reject rows: the DLQ intake worker stores a DlqIntakePayload
    // ({ sourceQueue, organizationId, projectId, eventType, payload, ... })
    // whose `payload` is an array of { event, detail } wrappers. Unwrap the
    // original raw events so replay re-processes them (they will re-fail
    // validation only if still poison).
    if (
      stored &&
      typeof stored === 'object' &&
      !Array.isArray(stored) &&
      typeof (stored as { sourceQueue?: unknown }).sourceQueue === 'string' &&
      typeof stored.organizationId === 'string' &&
      typeof stored.projectId === 'string'
    ) {
      const intake = stored as unknown as {
        eventType?: unknown;
        payload?: unknown;
      };
      const inner = intake.payload;
      const events = (Array.isArray(inner) ? inner : [inner]).map((item) =>
        item && typeof item === 'object' && 'event' in item
          ? (item as { event: unknown }).event
          : item,
      );
      const rawType = typeof intake.eventType === 'string' ? intake.eventType : row.job_type;
      if (!SDK_EVENT_TYPE_SET.has(rawType)) return null;
      const eventType = rawType as SdkEventType;
      return {
        organizationId: stored.organizationId,
        projectId: stored.projectId,
        eventType,
        events,
        metadata: {
          batchId: randomUUID(),
          apiKeyId: '',
          planTier: normalizePlanTier(null),
          receivedAt: new Date().toISOString(),
          environment: 'unknown',
          deferCount: 0,
          replay: true,
        },
      };
    }

    // Adapted shape: wrap the stored event(s) in a fresh payload.
    if (!row.org_id || !row.project_id) return null;
    if (!SDK_EVENT_TYPE_SET.has(row.job_type)) return null;
    const eventType = row.job_type as SdkEventType;
    const events = Array.isArray(row.payload) ? row.payload : [row.payload];
    const planTier = normalizePlanTier(null);
    return {
      organizationId: row.org_id,
      projectId: row.project_id,
      eventType,
      events,
      metadata: {
        batchId: randomUUID(),
        apiKeyId: '',
        planTier,
        receivedAt: new Date().toISOString(),
        environment: 'unknown',
        deferCount: 0,
        replay: true,
      },
    };
  }

  async reprocessAllDLQ(batchSize = 100, replayedBy?: string): Promise<number> {
    const safeBatch =
      Number.isFinite(batchSize) && batchSize > 0
        ? Math.min(Math.trunc(batchSize), 1000)
        : 100;

    const r = await this.pool.query<{ id: string }>(
      `SELECT id FROM ingestion_dead_letter_jobs
       WHERE replayed_at IS NULL
       ORDER BY failed_at ASC
       LIMIT $1`,
      [safeBatch],
    );
    let n = 0;
    for (const row of r.rows) {
      try {
        await this.reprocessDLQJob(row.id, replayedBy);
        n++;
      } catch (err) {
        // Log but keep draining: one bad row should not stop a bulk recovery.
        svcLogger.warn({ err, dlqId: row.id }, 'Failed to replay dead-letter row');
      }
    }
    return n;
  }

  /**
   * Replay historical telemetry by re-enqueuing it through the standard
   * pg-boss ingest path with replay metadata. Capped by
   * INGESTION_REPLAY_MAX_EVENTS to prevent operator typos flooding the queue.
   */
  async replayEvents(req: ReplayRequest): Promise<{ replayId: string; queued: number }> {
    const events = await this.writer.getEventsForReplay(
      req.projectId,
      req.startTime,
      req.endTime,
      req.eventTypes,
      this.replayMaxEvents,
    );
    const replayId = randomUUID();
    if (events.length === 0) return { replayId, queued: 0 };

    // Resolve the org's plan tier for priority math (admin path: no API key).
    const planCtx = await this.writer.getProjectPlanContext(req.projectId);
    const planTier = normalizePlanTier(planCtx?.planTier ?? null);
    const organizationId = planCtx?.orgId ?? events[0]?.orgId ?? '';
    const receivedAt = new Date().toISOString();

    const byType = new Map<SdkEventType, unknown[]>();
    for (const e of events) {
      if (!SDK_EVENT_TYPE_SET.has(e.type)) continue;
      const type = e.type as SdkEventType;
      const list = byType.get(type) ?? [];
      list.push(e.payload);
      byType.set(type, list);
    }
    if (byType.size === 0) return { replayId, queued: 0 };

    await ensureIngestQueuesProvisioned();
    const jobs = this.buildJobs({
      organizationId,
      projectId: req.projectId,
      apiKeyId: '',
      planTier,
      environment: 'replay',
      batchId: replayId,
      receivedAt,
      replay: true,
      byType,
    });
    const result = await enqueueIngestJobs(jobs);
    return { replayId, queued: result.enqueuedEvents };
  }

  // ── Read endpoints (delegate to writer) ───────────────────────────────────
  async listErrors(query: ErrorEventListQuery): Promise<ErrorEventListResult> {
    return this.writer.listErrorEvents(this.normalizeErrorEventListQuery(query));
  }
  async getErrorById(errorId: string, projectId: string): Promise<ErrorEventRecord | null> {
    return this.writer.getErrorEventById(errorId, projectId);
  }
  async getDebugEvent(eventId: string, projectId: string) {
    return this.writer.getEventById(eventId, projectId);
  }

  /** Drain in-process state. The queue is durable in Postgres. */
  async shutdown(): Promise<void> {
    this.rateLimiter.dispose();
    this.orgRateLimiter.dispose();
    this.quotaCache.clear();
    await this.usage.stop();
  }

  /**
   * Realtime per-project usage, read from project_usage_realtime (durable
   * hourly buckets + un-flushed staging tail). Optionally filtered to a single
   * counter type. Powers the GET /v1/usage endpoint.
   */
  async getProjectUsage(
    projectId: string,
    counterType?: string,
  ): Promise<Array<{ counterType: string; total: number; periodStart: string | null }>> {
    const params: unknown[] = [projectId];
    let typeClause = '';
    if (counterType) {
      params.push(counterType);
      typeClause = 'AND counter_type = $2';
    }
    const r = await this.pool.query<{
      counter_type: string;
      total: string;
      period_start: string | null;
    }>(
      `SELECT counter_type,
              SUM(total_value)::text AS total,
              MAX(period_start)::text AS period_start
       FROM project_usage_realtime
       WHERE project_id = $1 ${typeClause}
       GROUP BY counter_type
       ORDER BY counter_type`,
      params,
    );
    return r.rows.map((row) => ({
      counterType: row.counter_type,
      total: Number(row.total ?? 0),
      periodStart: row.period_start,
    }));
  }

  private normalizeErrorEventListQuery(
    query: ErrorEventListQuery,
  ): NormalizedErrorEventListQuery {
    const normalized: NormalizedErrorEventListQuery = {
      projectId: query.projectId,
      limit: this.normalizeInteger(query.limit, 50, 1, 100),
      offset: this.normalizeInteger(query.offset, 0, 0, 100_000),
    };
    const from = this.parseOptionalDate(query.from);
    const to = this.parseOptionalDate(query.to);
    if (from && to && from.getTime() > to.getTime()) throw new Error('INVALID_DATE_RANGE');
    if (from) normalized.from = from.toISOString();
    if (to) normalized.to = to.toISOString();
    if (query.fingerprint) normalized.fingerprint = query.fingerprint;
    if (query.errorType) normalized.errorType = query.errorType;
    if (query.resolved !== undefined) normalized.resolved = query.resolved;
    return normalized;
  }

  private parseOptionalDate(value?: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('INVALID_DATE_RANGE');
    return date;
  }

  private normalizeInteger(
    value: number | undefined,
    fallback: number,
    min: number,
    max: number,
  ): number {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(Math.trunc(value), max));
  }
}
