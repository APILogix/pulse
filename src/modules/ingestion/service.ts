/**
 * Ingestion business service — thin accept-and-enqueue gateway (pg-boss).
 *
 * Request-path flow (fast, no heavy work):
 *   1. Envelope checks (object / apiKey / non-empty events / batch cap).
 *   2. Resolve project from the API key (LRU cache -> Postgres fallback),
 *      including billing plan tier.
 *   3. Enforce project status, key permissions, and a cached org quota
 *      pre-check.
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
import {
  syncApiKeyLookupToLogDbBestEffort,
  syncEnvironmentLookupToLogDbBestEffort,
  syncEnvironmentSdkConfigLookupToLogDbBestEffort,
  syncProjectLookupToLogDbBestEffort,
} from '../../shared/logdb/lookup-sync.js';
import { PostgresWriter } from './postgress.writter.js';
import { UsageCounter } from './usage/usage-counter.js';
import {
  SDK_EVENT_TYPES,
  normalizeSdkEnvironment,
  type SdkEventType,
} from './pipeline/event-normalizer.js';
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
} from './types.js';
import type {
  DeliveryResult,
  RemoteSdkConfigService,
} from '../projects/sdk-config/sdk-config.service.js';
import { entitlementsService } from '../billing/entitlements/service.js';

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
let queuesProvisioned = false;

function ensureIngestQueuesProvisioned(): Promise<void> {
  if (!provisioningPromise) {
    provisioningPromise = provisionIngestQueues()
      .then(() => {
        queuesProvisioned = true;
      })
      .catch((err) => {
        queuesProvisioned = false;
        provisioningPromise = null; // allow retry on the next request
        svcLogger.error({ err }, 'ingest queue provisioning failed');
        throw err;
      });
  }
  return provisioningPromise;
}

function warmIngestQueuesProvisioned(): void {
  ensureIngestQueuesProvisioned().catch(() => undefined);
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
  jobMaxBytes?: number;
}

interface AcceptedIngestEvent {
  raw: unknown;
  bytes: number;
}

interface ResolvedProject {
  id: string;
  projectSlug?: string | undefined;
  projectName?: string | undefined;
  orgId: string;
  orgName?: string | undefined;
  orgSlug?: string | undefined;
  environmentId: string;
  environmentName: string;
  environmentSlug: string;
  rateLimitPerSecond: number;
  rateLimitPerMinute: number;
  rateLimitPerHour: number | null;
  isActive: boolean;
  apiKeyId: string;
  apiKeyName: string;
  keyType: string;
  rotationVersion: number;
  permissions: string[];
  allowedEndpoints: string[];
  blockedEndpoints: string[];
  allowedEventTypes: string[];
  allowedOrigins: string[];
  allowedIps: string[];
  allowedDomains: string[];
  allowedSdks: string[];
  planTier: PlanTier;
  orgRateLimitPerSecond: number;
  orgRateLimitPerMinute: number;
}

interface QuotaCacheEntry {
  eventsUsed: number;
  eventLimit: number;
  usageBehavior: 'none' | 'hard_limit' | 'soft_limit' | 'overage' | 'throttle';
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

function elapsedSince(start: number): number {
  return Date.now() - start;
}

export class IngestionService {
  private readonly usage: UsageCounter;
  private readonly backpressure: BackpressureConfig;
  private readonly replayMaxEvents: number;
  private readonly maxBatchSize: number;
  private readonly jobChunkSize: number;
  private readonly jobMaxBytes: number;
  private readonly defaultRatePerSecond: number;
  private readonly defaultRatePerMinute: number;
  // Cached queue-depth probe so request-path backpressure stays O(1). The
  // grouped scan on pgboss.job refreshes in the background; ingestion never
  // waits on this advisory signal.
  private cachedDepth: IngestQueueDepthSnapshot = {
    pending: 0,
    ready: 0,
    deferred: 0,
    active: 0,
    failed: 0,
    deadLettered: 0,
    oldestPendingAgeMs: null,
    perQueue: [],
    dlqPerQueue: [],
  };
  private cachedDepthAt = 0;
  private depthRefreshPromise: Promise<void> | null = null;

  // Cached org quota reads (organization_usage_current_period), fail-open.
  private readonly quotaCache = new Map<string, QuotaCacheEntry>();
  private readonly quotaRefreshes = new Map<string, Promise<void>>();
  private readonly quotaCacheTtlMs = env.INGESTION_QUOTA_CACHE_TTL_MS;

  constructor(
    private readonly pool: Pool,
    private readonly writer: PostgresWriter,
    config: ServiceConfig,
    private readonly sdkConfigService?: RemoteSdkConfigService,
  ) {
    this.maxBatchSize = config.maxBatchSize;
    this.defaultRatePerSecond = config.defaultRateLimitPerSecond;
    this.defaultRatePerMinute = config.defaultRateLimitPerMinute;
    this.backpressure = config.backpressure ?? DEFAULT_BACKPRESSURE;
    this.replayMaxEvents = config.replayMaxEvents ?? env.INGESTION_REPLAY_MAX_EVENTS;
    this.jobChunkSize = config.jobChunkSize ?? env.INGESTION_JOB_CHUNK_SIZE;
    this.jobMaxBytes = Math.max(MAX_EVENT_BYTES, config.jobMaxBytes ?? env.INGESTION_JOB_MAX_BYTES);
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
    // in main.ts). The request path enqueues optimistically and only waits for
    // provisioning if the enqueue proves queues are unavailable.
    warmIngestQueuesProvisioned();

    // Register with central entitlements invalidation event bus
    entitlementsService.onOrgInvalidate((orgId) => this.invalidateOrgQuotaCache(orgId));
  }

  public invalidateOrgQuotaCache(orgId: string): void {
    this.quotaCache.delete(orgId);
  }

  // ── Project resolution (LRU only; Postgres fallback) ──────────────────────
  private async resolveProject(apiKey: string): Promise<ResolvedProject | null> {
    const keyHash = hashApiKey(apiKey);

    const cached = apiKeyCache.get(keyHash) as CachedProjectConfig | undefined;
    if (cached) {
      return {
        id: cached.id,
        projectSlug: cached.slug,
        projectName: cached.name,
        orgId: cached.orgId,
        orgName: cached.orgName,
        orgSlug: cached.orgSlug,
        environmentId: cached.environmentId,
        environmentName: cached.environmentName ?? cached.environment,
        environmentSlug: cached.environment,
        rateLimitPerSecond: cached.rateLimitPerSecond,
        rateLimitPerMinute: cached.rateLimitPerMinute,
        rateLimitPerHour: cached.rateLimitPerHour ?? null,
        isActive: cached.isActive,
        apiKeyId: cached.apiKeyId,
        apiKeyName: cached.apiKeyName,
        keyType: 'read_write',
        rotationVersion: 1,
        permissions: cached.permissions ?? [],
        allowedEndpoints: cached.allowedEndpoints.length ? cached.allowedEndpoints : ['*'],
        blockedEndpoints: cached.blockedEndpoints ?? [],
        allowedEventTypes: cached.allowedEventTypes.length ? cached.allowedEventTypes : ['*'],
        allowedOrigins: cached.allowedOrigins ?? [],
        allowedIps: cached.allowedIps ?? [],
        allowedDomains: cached.allowedDomains ?? [],
        allowedSdks: cached.allowedSdks ?? [],
        planTier: normalizePlanTier(cached.planTier),
        orgRateLimitPerSecond:
          cached.orgRateLimitPerSecond ?? env.INGESTION_ORG_RATE_LIMIT_PER_SECOND,
        orgRateLimitPerMinute:
          cached.orgRateLimitPerMinute ?? env.INGESTION_ORG_RATE_LIMIT_PER_MINUTE,
      };
    }

    const auth = await this.writer.resolveApiKey(apiKey);
    if (!auth) return null;

    const resolved: ResolvedProject = {
      id: auth.projectId,
      projectSlug: auth.projectSlug,
      projectName: auth.projectName,
      orgId: auth.orgId,
      orgName: auth.orgName,
      orgSlug: auth.orgSlug,
      environmentId: auth.environmentId,
      environmentName: auth.environmentName,
      environmentSlug: auth.environmentSlug,
      rateLimitPerSecond: auth.rateLimitPerSecond ?? this.defaultRatePerSecond,
      rateLimitPerMinute: auth.rateLimitPerMinute ?? this.defaultRatePerMinute,
      rateLimitPerHour: auth.rateLimitPerHour ?? null,
      isActive: auth.isActive && auth.projectStatus === 'active',
      apiKeyId: auth.apiKeyId,
      apiKeyName: auth.apiKeyName,
      keyType: auth.keyType,
      rotationVersion: auth.rotationVersion,
      permissions: auth.permissions,
      allowedEndpoints: auth.allowedEndpoints.length ? auth.allowedEndpoints : ['*'],
      blockedEndpoints: auth.blockedEndpoints,
      allowedEventTypes: auth.allowedEventTypes.length ? auth.allowedEventTypes : ['*'],
      allowedOrigins: auth.allowedOrigins,
      allowedIps: auth.allowedIps,
      allowedDomains: auth.allowedDomains,
      allowedSdks: auth.allowedSdks,
      planTier: normalizePlanTier(auth.planTier),
      orgRateLimitPerSecond:
        auth.orgRateLimitPerSecond ?? env.INGESTION_ORG_RATE_LIMIT_PER_SECOND,
      orgRateLimitPerMinute:
        auth.orgRateLimitPerMinute ?? env.INGESTION_ORG_RATE_LIMIT_PER_MINUTE,
    };

    apiKeyCache.set(keyHash, {
      id: resolved.id,
      slug: resolved.projectSlug,
      orgId: resolved.orgId,
      name: auth.projectName,
      orgName: resolved.orgName,
      orgSlug: resolved.orgSlug,
      environment: resolved.environmentSlug,
      environmentId: resolved.environmentId,
      environmentName: resolved.environmentName,
      rateLimitPerSecond: resolved.rateLimitPerSecond,
      rateLimitPerMinute: resolved.rateLimitPerMinute,
      rateLimitPerHour: resolved.rateLimitPerHour,
      allowedEventTypes: resolved.allowedEventTypes,
      permissions: resolved.permissions,
      allowedEndpoints: resolved.allowedEndpoints,
      blockedEndpoints: resolved.blockedEndpoints,
      allowedOrigins: resolved.allowedOrigins,
      allowedIps: resolved.allowedIps,
      allowedDomains: resolved.allowedDomains,
      allowedSdks: resolved.allowedSdks,
      isActive: resolved.isActive,
      apiKeyId: resolved.apiKeyId,
      apiKeyName: resolved.apiKeyName,
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

  private refreshQueueDepth(): void {
    if (this.depthRefreshPromise) return;
    this.depthRefreshPromise = ingestQueueDepth(this.pool)
      .then((depth) => {
        this.cachedDepth = depth;
        this.cachedDepthAt = Date.now();
      })
      .catch((err) => {
        svcLogger.debug({ err }, 'ingest queue depth refresh failed; keeping stale backpressure snapshot');
      })
      .finally(() => {
        this.depthRefreshPromise = null;
      });
  }

  /** Cached queue-depth probe (background refreshed at most every 1s). */
  private async queueDepth(): Promise<IngestQueueDepthSnapshot> {
    const now = Date.now();
    if (now - this.cachedDepthAt > 1000) {
      this.refreshQueueDepth();
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
   * Cached quota pre-check against the canonical monthly_events entitlement.
   * Fail-open by design: a missing/stale row or a DB error allows the batch
   * while a background refresh updates the cache. A cached hard-limit/throttle
   * violation still blocks immediately.
   */
  private refreshQuotaCache(orgId: string): void {
    if (this.quotaRefreshes.has(orgId)) return;
    const refresh = (async () => {
      try {
        const [eventLimit, usageResult] = await Promise.all([
          entitlementsService.getEffectiveIntegerFeature(orgId, 'quota.monthly_events'),
          this.pool.query<{ events_used: string }>(
            `SELECT events_used FROM organization_usage_current_period WHERE organization_id = $1`,
            [orgId],
          ),
        ]);
        const eventsUsed = Number(usageResult.rows[0]?.events_used) || 0;
        if (this.quotaCache.size >= QUOTA_CACHE_MAX_ENTRIES) {
          const oldest = this.quotaCache.keys().next();
          if (!oldest.done) this.quotaCache.delete(oldest.value);
        }
        this.quotaCache.set(orgId, {
          eventsUsed,
          eventLimit,
          usageBehavior: 'hard_limit',
          at: Date.now(),
        });
      } catch (err) {
        svcLogger.warn({ err, orgId }, 'Ingestion quota pre-check failed to refresh billing state; allowing batches under fail-open policy');
      } finally {
        this.quotaRefreshes.delete(orgId);
      }
    })();
    this.quotaRefreshes.set(orgId, refresh);
  }

  private assertQuotaAvailable(orgId: string): void {
    const now = Date.now();
    const entry = this.quotaCache.get(orgId);
    if (!entry) {
      this.refreshQuotaCache(orgId);
      return;
    }
    if (now - entry.at > this.quotaCacheTtlMs) {
      this.refreshQuotaCache(orgId);
    }
    if (
      entry.eventLimit >= 0
      && entry.eventsUsed >= entry.eventLimit
      && (entry.usageBehavior === 'hard_limit' || entry.usageBehavior === 'throttle')
    ) {
      throw new Error('QUOTA_EXCEEDED');
    }
  }

  // ── SDK init handshake ────────────────────────────────────────────────────
  async initializeSdk(apiKey: string): Promise<DeliveryResult> {
    const project = await this.resolveProject(apiKey);
    if (!project) throw new Error('INVALID_API_KEY');
    if (!project.isActive) throw new Error('PROJECT_INACTIVE');
    if (!this.sdkConfigService) throw new Error('CONFIG_UNAVAILABLE');

    this.syncInitLookupsBestEffort(project);

    try {
      return await this.sdkConfigService.buildDelivery(
        {
          organizationId: project.orgId,
          projectId: project.id,
          defaultEnvironmentId: project.environmentId,
          allowedEnvironmentIds: [project.environmentId],
        },
        { schemaVersion: 1, environmentId: project.environmentId },
      );
    } catch (error) {
      svcLogger.error({ err: error, projectId: project.id }, 'canonical SDK initialization failed');
      throw new Error('CONFIG_UNAVAILABLE');
    }
  }

  private syncInitLookupsBestEffort(project: ResolvedProject): void {
    syncProjectLookupToLogDbBestEffort(project.id, 'sdk.init');
    syncEnvironmentLookupToLogDbBestEffort(project.environmentId, 'sdk.init');
    syncApiKeyLookupToLogDbBestEffort(project.apiKeyId, 'sdk.init');
    syncEnvironmentSdkConfigLookupToLogDbBestEffort(project.environmentId, 'sdk.init');
  }

  // ── Ingestion entrypoints ─────────────────────────────────────────────────
  /**
   * Legacy mixed-batch entrypoint (POST /v1/ingest). Accepts any combination of
   * SDK event types in a single request. Retained for backward compatibility;
   * new SDK transports use the per-signal typed routes via ingestTyped().
   */
  async ingestBatch(req: IngestRequest, apiKey: string): Promise<IngestResponse> {
    return this.processIngest(req, null, apiKey);
  }

  /**
   * Public typed-ingestion entrypoint used by the data-driven route table
   * (route-table.ts). It is a thin pass-through to the single policy boundary
   * `processIngest`, so API-key validation, quota checks, admission control,
   * backpressure, per-event type enforcement, and queue-priority math are never
   * duplicated per endpoint. A typed route accepts ONLY its declared event
   * family; any foreign event fails the whole batch with INVALID_EVENT_TYPE.
   */
  async ingestTyped(
    req: IngestRequest,
    apiKey: string,
    type: SdkEventType,
  ): Promise<IngestResponse> {
    return this.processIngest(req, type, apiKey);
  }

  // Named aliases retained for the legacy `POST /v1/ingest/<type>` routes.
  async ingestRequests(req: IngestRequest, apiKey: string): Promise<IngestResponse> {
    return this.ingestTyped(req, apiKey, 'request');
  }
  async ingestErrors(req: IngestRequest, apiKey: string): Promise<IngestResponse> {
    return this.ingestTyped(req, apiKey, 'error');
  }
  async ingestLogs(req: IngestRequest, apiKey: string): Promise<IngestResponse> {
    return this.ingestTyped(req, apiKey, 'log');
  }
  async ingestMetrics(req: IngestRequest, apiKey: string): Promise<IngestResponse> {
    return this.ingestTyped(req, apiKey, 'metric');
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
    const startedAt = Date.now();
    const timings: Record<string, number> = {};
    // 1. Envelope checks.
    const envelopeStartedAt = Date.now();
    if (!req || typeof req !== 'object') throw new Error('INVALID_REQUEST');
    const { events } = req;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error('INVALID_API_KEY');
    }
    if (!Array.isArray(events) || events.length === 0) throw new Error('EMPTY_BATCH');
    if (events.length > this.maxBatchSize) throw new Error('BATCH_TOO_LARGE');
    timings.envelopeMs = elapsedSince(envelopeStartedAt);
    // 2. Project resolution (+ plan tier).
    const projectLookupStartedAt = Date.now();
    const project = await this.resolveProject(apiKey);
    timings.projectLookupMs = elapsedSince(projectLookupStartedAt);
    if (!project) throw new Error('INVALID_API_KEY');
    if (!project.isActive) throw new Error('PROJECT_INACTIVE');
    const normalizationStartedAt = Date.now();
    const suppliedEnvironment = req.metadata?.environment;
    const environment = suppliedEnvironment === undefined || suppliedEnvironment === null
      ? normalizeSdkEnvironment(project.environmentSlug)
      : normalizeSdkEnvironment(suppliedEnvironment);
    if (!environment) throw new Error('INVALID_ENVIRONMENT');
    timings.normalizationMs = elapsedSince(normalizationStartedAt);

    // 3. Key permissions.
    const authzStartedAt = Date.now();
    this.assertKeyCanUseEndpoint(project, expectedType);
    timings.authzMs = elapsedSince(authzStartedAt);

    // 4. Route-level rate limiting is currently disabled for ingestion.
    timings.rateLimitMs = 0;

    // 5. Quota pre-check (cached, fail-open).
    const quotaStartedAt = Date.now();
    this.assertQuotaAvailable(project.orgId);
    timings.quotaMs = elapsedSince(quotaStartedAt);

    // Queue provisioning is warmed in the background. Avoid putting createQueue
    // work on the normal request path; enqueue below will provision-and-retry
    // once if queues are actually unavailable.
    const queueProvisionStartedAt = Date.now();
    if (!queuesProvisioned && !provisioningPromise) {
      warmIngestQueuesProvisioned();
    }
    timings.queueProvisionMs = elapsedSince(queueProvisionStartedAt);

    // 6. Backpressure snapshot (cached at 1s granularity).
    const queueDepthStartedAt = Date.now();
    const depth = await this.queueDepth();
    timings.queueDepthMs = elapsedSince(queueDepthStartedAt);

    const batchId = randomUUID();
    const receivedAt = new Date().toISOString();
    const errors: Array<{ eventId: string; reason: string }> = [];
    const acceptedByType = new Map<SdkEventType, AcceptedIngestEvent[]>();
    let acceptedBytes = 0;
    let shed = 0;

    // 7. Per-event BASIC validation only. Full Zod normalization runs in the
    // workers; the gateway must stay cheap enough to absorb floods.
    const validationStartedAt = Date.now();
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
        // Typed-route contract: a dedicated endpoint (e.g. POST /v1/errors)
        // accepts ONLY its declared event family. A foreign event means the SDK
        // targeted the wrong route — a client misconfiguration — so we fail the
        // whole batch fast with INVALID_EVENT_TYPE (400) rather than silently
        // dropping events. Mixed batches must use the legacy POST /v1/ingest
        // path (expectedType === null), which never sets this constraint.
        throw new Error('INVALID_EVENT_TYPE');
      }

      let serialized: string;
      try {
        serialized = JSON.stringify(raw);
      } catch {
        errors.push({ eventId, reason: 'event_not_serializable' });
        continue;
      }
      const eventBytes = Buffer.byteLength(serialized);
      if (eventBytes > MAX_EVENT_BYTES) {
        errors.push({ eventId, reason: 'event_too_large' });
        continue;
      }

      if (this.shouldShed(depth.pending, project.planTier, eventType)) {
        shed++;
        errors.push({ eventId, reason: 'shed_backpressure' });
        continue;
      }

      if (!this.isEventTypeAllowed(project, eventType)) {
        errors.push({ eventId, reason: 'event_type_not_allowed' });
        continue;
      }

      const list = acceptedByType.get(eventType) ?? [];
      list.push({ raw, bytes: eventBytes });
      acceptedBytes += eventBytes;
      acceptedByType.set(eventType, list);
    }
    timings.validationMs = elapsedSince(validationStartedAt);

    // 8. Chunk per type and enqueue one pg-boss job per (type, chunk).
    let accepted = 0;
    let jobsBuilt = 0;
    let enqueueQueues: Array<{
      queue: string;
      jobs: number;
      events: number;
      bulk: boolean;
      fallback: boolean;
      durationMs: number;
    }> = [];
    if (acceptedByType.size > 0) {
      const jobBuildStartedAt = Date.now();
      const jobs = this.buildJobs({
        organizationId: project.orgId,
        projectId: project.id,
        projectSlug: project.projectSlug,
        projectName: project.projectName,
        orgSlug: project.orgSlug,
        orgName: project.orgName,
        apiKeyId: project.apiKeyId,
        apiKeyName: project.apiKeyName,
        planTier: project.planTier,
        environment,
        batchId,
        receivedAt,
        byType: acceptedByType,
      });
      jobsBuilt = jobs.length;
      timings.jobBuildMs = elapsedSince(jobBuildStartedAt);
      const submittedEvents = jobs.reduce((n, job) => n + job.payload.events.length, 0);
      svcLogger.debug(
        {
          batchId,
          expectedType: expectedType ?? 'mixed',
          eventTypes: Object.fromEntries(
            [...acceptedByType.entries()].map(([type, list]) => [type, list.length]),
          ),
          queues: jobs.map((job) => ({
            queue: job.queue,
            eventType: job.payload.eventType,
            events: job.payload.events.length,
            bytes: job.payload.events.reduce<number>((sum, event) => sum + this.eventBytes(event), 0),
          })),
          submittedEvents,
        },
        'ingestion events queued for workers',
      );
      const enqueueStartedAt = Date.now();
      let result;
      try {
        result = await enqueueIngestJobs(jobs);
      } catch (err) {
        if (queuesProvisioned) throw err;
        const provisionRetryStartedAt = Date.now();
        await ensureIngestQueuesProvisioned();
        timings.queueProvisionRetryMs = elapsedSince(provisionRetryStartedAt);
        result = await enqueueIngestJobs(jobs);
      }
      timings.enqueueMs = elapsedSince(enqueueStartedAt);
      enqueueQueues = result.queues;
      accepted = result.enqueuedEvents;
      svcLogger.info(
        {
          phase: '1_received',
          batchId,
          eventType: expectedType ?? 'mixed',
          projectId: project.id,
          environment,
          received: (events as unknown[]).length,
          accepted,
          rejected: errors.length,
          shed,
        },
        '[Phase 1/4] Event ingestion received',
      );
      if (accepted < submittedEvents) {
        acceptedBytes = submittedEvents > 0 ? Math.floor(acceptedBytes * accepted / submittedEvents) : 0;
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

    // Canonical usage accounting: the gateway records requests/errors/rate
    // limits, while the persistence worker records accepted events exactly
    // once after idempotent storage.
    const usageStartedAt = Date.now();
    const usageDimensions = {
      apiKeyId: project.apiKeyId,
      eventType: 'all',
    };
    this.usage.increment(project.id, project.orgId, 'requests', 1, usageDimensions);
    if (acceptedBytes > 0) {
      this.usage.increment(project.id, project.orgId, 'bytes_ingested', acceptedBytes, usageDimensions);
    }
    if (errors.length > 0) {
      this.usage.increment(project.id, project.orgId, 'errors', errors.length, usageDimensions);
    }
    if (shed > 0) {
      this.usage.increment(project.id, project.orgId, 'rate_limited', shed, usageDimensions);
    }
    timings.usageAccountingMs = elapsedSince(usageStartedAt);
    timings.totalAdmissionMs = elapsedSince(startedAt);

    svcLogger.info(
      {
        phase: 'ingestion_admission_profile',
        batchId,
        eventType: expectedType ?? 'mixed',
        projectId: project.id,
        environment,
        received: (events as unknown[]).length,
        accepted,
        rejected: errors.length,
        shed,
        acceptedBytes,
        queueDepthPending: depth.pending,
        jobsBuilt,
        enqueueQueues,
        ...timings,
      },
      'ingestion admission profile',
    );

    const response: IngestResponse = {
      success: true,
      accepted,
      rejected: errors.length,
      batchId,
      limits: {
        remaining: Number.MAX_SAFE_INTEGER,
        resetAt: 0,
      },
    };
    if (errors.length > 0) response.errors = errors;
    return response;
  }

  /**
   * Build one pg-boss job per event type, bounded by event count and
   * approximate serialized event bytes. Events are carried RAW (un-normalized)
   * — normalization is worker-side.
   */
  private buildJobs(params: {
    organizationId: string;
    projectId: string;
    apiKeyId: string;
    apiKeyName: string;
    planTier: PlanTier;
    environment: string;
    batchId: string;
    receivedAt: string;
    replay?: boolean | undefined;
    byType: Map<SdkEventType, AcceptedIngestEvent[]>;
    projectSlug?: string | undefined;
    projectName?: string | undefined;
    orgSlug?: string | undefined;
    orgName?: string | undefined;
  }): Array<{ queue: string; payload: IngestJobPayload; priority: number }> {
    const jobs: Array<{ queue: string; payload: IngestJobPayload; priority: number }> = [];
    for (const [type, list] of params.byType) {
      let chunk: unknown[] = [];
      let chunkBytes = 0;
      for (const item of list) {
        if (chunk.length > 0 && (chunk.length >= this.jobChunkSize || chunkBytes + item.bytes > this.jobMaxBytes)) {
          jobs.push(this.buildJob(params, type, chunk));
          chunk = [];
          chunkBytes = 0;
        }
        chunk.push(item.raw);
        chunkBytes += item.bytes;
      }
      if (chunk.length > 0) {
        jobs.push(this.buildJob(params, type, chunk));
      }
    }
    return jobs;
  }

  private buildJob(
    params: Omit<Parameters<IngestionService['buildJobs']>[0], 'byType'>,
    type: SdkEventType,
    events: unknown[],
  ): { queue: string; payload: IngestJobPayload; priority: number } {
    const metadata: IngestJobMetadata = {
      batchId: params.batchId,
      apiKeyId: params.apiKeyId,
      apiKeyName: params.apiKeyName,
      planTier: params.planTier,
      receivedAt: params.receivedAt,
      environment: params.environment,
      deferCount: 0,
      projectSlug: params.projectSlug,
      projectName: params.projectName,
      orgSlug: params.orgSlug,
      orgName: params.orgName,
      ...(params.replay ? { replay: true } : {}),
    };
    return {
      queue: ingestQueueFor(type),
      payload: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        eventType: type,
        events,
        metadata,
      },
      priority: jobPriority(params.planTier, type),
    };
  }

  private eventBytes(event: unknown): number {
    try {
      return Buffer.byteLength(JSON.stringify(event));
    } catch {
      return 0;
    }
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

  private isEventTypeAllowed(project: ResolvedProject, eventType: SdkEventType): boolean {
    const allowed = project.allowedEventTypes;
    if (allowed.length === 0 || allowed.includes('*')) return true;
    return allowed.includes(eventType);
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
      rateLimiterEntries: 0,
      orgRateLimiterEntries: 0,
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
      enabled: false,
      perSecond: null,
      perMinute: null,
      maxBatchSize: this.maxBatchSize,
      orgPerSecond: null,
      orgPerMinute: null,
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
   * Rebuild an IngestJobPayload from a DLQ row. The stored payload must retain
   * either the original job metadata.environment or the complete validation
   * DLQ envelope with its environment. Older bare-event rows are rejected:
   * replay must never invent an environment storage dimension.
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
      const environment = normalizeSdkEnvironment(meta.environment);
      if (!environment) return null;
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
          environment,
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
        environment?: unknown;
        payload?: unknown;
      };
      const environment = normalizeSdkEnvironment(intake.environment);
      if (!environment) return null;
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
          environment,
          deferCount: 0,
          replay: true,
        },
      };
    }

    // Bare historical DLQ rows have no trustworthy SDK envelope environment.
    // They cannot be replayed without fabricating a storage dimension.
    return null;
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
    const requestedEnvironment = req.environment === undefined
      ? undefined
      : normalizeSdkEnvironment(req.environment);
    if (req.environment !== undefined && !requestedEnvironment) throw new Error('INVALID_ENVIRONMENT');
    const replayEnvironment = requestedEnvironment ?? undefined;

    const events = await this.writer.getEventsForReplay(
      req.projectId,
      req.startTime,
      req.endTime,
      req.eventTypes,
      this.replayMaxEvents,
      replayEnvironment,
    );
    const replayId = randomUUID();
    if (events.length === 0) return { replayId, queued: 0 };

    // Resolve the org's plan tier for priority math (admin path: no API key).
    const planCtx = await this.writer.getProjectPlanContext(req.projectId);
    const planTier = normalizePlanTier(planCtx?.planTier ?? null);
    const organizationId = planCtx?.orgId ?? events[0]?.orgId ?? '';
    const receivedAt = new Date().toISOString();

    // Never collapse historical environments into a synthetic "replay" value.
    // Each environment gets its own job batch with the original normalized
    // storage dimension copied into mandatory job metadata.
    const byEnvironment = new Map<string, Map<SdkEventType, AcceptedIngestEvent[]>>();
    for (const e of events) {
      if (!SDK_EVENT_TYPE_SET.has(e.type)) continue;
      const environment = normalizeSdkEnvironment(e.environment);
      if (!environment) continue;
      const type = e.type as SdkEventType;
      const byType = byEnvironment.get(environment) ?? new Map<SdkEventType, AcceptedIngestEvent[]>();
      const list = byType.get(type) ?? [];
      list.push({ raw: e.payload, bytes: this.eventBytes(e.payload) });
      byType.set(type, list);
      byEnvironment.set(environment, byType);
    }
    if (byEnvironment.size === 0) return { replayId, queued: 0 };

    await ensureIngestQueuesProvisioned();
    const jobs = [...byEnvironment.entries()].flatMap(([environment, byType]) =>
      this.buildJobs({
        organizationId,
        projectId: req.projectId,
        apiKeyId: '',
        apiKeyName: 'unknown',
        planTier,
        environment,
        batchId: replayId,
        receivedAt,
        replay: true,
        byType,
      }),
    );
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
    const canonicalMetrics = [
      "total_events",
      "errors",
      "requests",
      "total_bytes",
      "rate_limit_usage",
    ] as const;
    if (counterType && !canonicalMetrics.includes(counterType as (typeof canonicalMetrics)[number])) {
      return [];
    }
    const params: unknown[] = [projectId];
    if (counterType) params.push(counterType);
    const r = await this.pool.query<{
      counter_type: string;
      total: string;
      period_start: string | null;
    }>(
      `SELECT metric.counter_type,
              SUM(metric.value)::text AS total,
              MAX(usage.bucket)::text AS period_start
         FROM project_usage_realtime usage
         CROSS JOIN LATERAL (VALUES
           ('total_events', usage.total_events::numeric),
           ('errors', usage.errors::numeric),
           ('requests', usage.requests::numeric),
           ('total_bytes', usage.total_bytes::numeric),
           ('rate_limit_usage', usage.rate_limit_usage::numeric)
         ) metric(counter_type, value)
        WHERE usage.project_id = $1
          ${counterType ? "AND metric.counter_type = $2" : ""}
        GROUP BY metric.counter_type
        ORDER BY metric.counter_type`,
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
    const environment = query.environment === undefined
      ? undefined
      : normalizeSdkEnvironment(query.environment);
    if (query.environment !== undefined && !environment) throw new Error('INVALID_ENVIRONMENT');
    if (environment) normalized.environment = environment;
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
