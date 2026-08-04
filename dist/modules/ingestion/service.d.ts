import type { Pool } from 'pg';
import { PostgresWriter } from './postgress.writter.js';
import { type SdkEventType } from './pipeline/event-normalizer.js';
import { type PlanTier } from './queue/ingest-queues.js';
import type { IngestRequest, IngestResponse, ErrorEventListQuery, ErrorEventListResult, ErrorEventRecord, ReplayRequest, HealthStatus } from './types.js';
import type { DeliveryResult, RemoteSdkConfigService } from '../projects/sdk-config/sdk-config.service.js';
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
export declare class IngestionService {
    private readonly pool;
    private readonly writer;
    private readonly sdkConfigService?;
    private readonly rateLimiter;
    private readonly orgRateLimiter;
    private readonly usage;
    private readonly backpressure;
    private readonly replayMaxEvents;
    private readonly maxBatchSize;
    private readonly jobChunkSize;
    private readonly defaultRatePerSecond;
    private readonly defaultRatePerMinute;
    private cachedDepth;
    private cachedDepthAt;
    private readonly quotaCache;
    private readonly quotaCacheTtlMs;
    constructor(pool: Pool, writer: PostgresWriter, config: ServiceConfig, sdkConfigService?: RemoteSdkConfigService | undefined);
    private resolveProject;
    /** Cached queue-depth probe (refreshed at most every 1s). */
    private queueDepth;
    /**
     * Plan-aware shedding. At high water we shed anything below the business
     * tier floor (PLAN_WEIGHT.business + top urgency), so free/starter/growth
     * traffic sheds first. At critical water only business/enterprise batches
     * of top-urgency types (error / message / cron_checkin) pass.
     */
    private shouldShed;
    /**
     * Cached quota pre-check against the canonical monthly_events entitlement.
     * Fail-open by design: a missing row or a DB error allows the batch
     * (authoritative enforcement happens worker-side / in billing rollups).
     */
    private assertQuotaAvailable;
    initializeSdk(apiKey: string): Promise<DeliveryResult>;
    private syncInitLookupsBestEffort;
    /**
     * Legacy mixed-batch entrypoint (POST /v1/ingest). Accepts any combination of
     * SDK event types in a single request. Retained for backward compatibility;
     * new SDK transports use the per-signal typed routes via ingestTyped().
     */
    ingestBatch(req: IngestRequest, apiKey: string): Promise<IngestResponse>;
    /**
     * Public typed-ingestion entrypoint used by the data-driven route table
     * (route-table.ts). It is a thin pass-through to the single policy boundary
     * `processIngest`, so API-key validation, quota checks, rate limits,
     * backpressure, per-event type enforcement, and queue-priority math are never
     * duplicated per endpoint. A typed route accepts ONLY its declared event
     * family; any foreign event fails the whole batch with INVALID_EVENT_TYPE.
     */
    ingestTyped(req: IngestRequest, apiKey: string, type: SdkEventType): Promise<IngestResponse>;
    ingestRequests(req: IngestRequest, apiKey: string): Promise<IngestResponse>;
    ingestErrors(req: IngestRequest, apiKey: string): Promise<IngestResponse>;
    ingestLogs(req: IngestRequest, apiKey: string): Promise<IngestResponse>;
    ingestMetrics(req: IngestRequest, apiKey: string): Promise<IngestResponse>;
    /**
     * Central pipeline — a thin accept-and-enqueue path. `expectedType` (when
     * set) enforces a typed route: every event must match it or be rejected.
     */
    private processIngest;
    /**
     * Build one pg-boss job per (event type, chunk of <= jobChunkSize events).
     * Events are carried RAW (un-normalized) — normalization is worker-side.
     */
    private buildJobs;
    /** Best-effort stable id for a single event in a batch. */
    private extractEventId;
    private assertKeyCanUseEndpoint;
    private isEventTypeAllowed;
    getHealth(): Promise<HealthStatus>;
    getIngestionHealth(): Promise<unknown>;
    getLimits(apiKey: string): Promise<{
        perSecond: number;
        perMinute: number;
        maxBatchSize: number;
        orgPerSecond: number;
        orgPerMinute: number;
        planTier: PlanTier;
    }>;
    /**
     * Paginated listing of dead-lettered jobs. Uses bounded offset/limit with
     * defensive validation: callers may pass arbitrary integers; we clamp them
     * before they touch the SQL.
     */
    getDLQJobs(offset?: number, limit?: number): Promise<unknown[]>;
    /**
     * Re-enqueue one dead-lettered job through the pg-boss ingest queues. The
     * DLQ intake worker stores the original IngestJobPayload in the payload
     * column, so we reconstruct it, flag metadata.replay, and re-enqueue with
     * the same plan-aware priority math as live traffic.
     */
    reprocessDLQJob(jobId: string, replayedBy?: string): Promise<void>;
    /**
     * Rebuild an IngestJobPayload from a DLQ row. The stored payload must retain
     * either the original job metadata.environment or the complete validation
     * DLQ envelope with its environment. Older bare-event rows are rejected:
     * replay must never invent an environment storage dimension.
     */
    private dlqRowToJobPayload;
    reprocessAllDLQ(batchSize?: number, replayedBy?: string): Promise<number>;
    /**
     * Replay historical telemetry by re-enqueuing it through the standard
     * pg-boss ingest path with replay metadata. Capped by
     * INGESTION_REPLAY_MAX_EVENTS to prevent operator typos flooding the queue.
     */
    replayEvents(req: ReplayRequest): Promise<{
        replayId: string;
        queued: number;
    }>;
    listErrors(query: ErrorEventListQuery): Promise<ErrorEventListResult>;
    getErrorById(errorId: string, projectId: string): Promise<ErrorEventRecord | null>;
    getDebugEvent(eventId: string, projectId: string): Promise<unknown>;
    /** Drain in-process state. The queue is durable in Postgres. */
    shutdown(): Promise<void>;
    /**
     * Realtime per-project usage, read from project_usage_realtime (durable
     * hourly buckets + un-flushed staging tail). Optionally filtered to a single
     * counter type. Powers the GET /v1/usage endpoint.
     */
    getProjectUsage(projectId: string, counterType?: string): Promise<Array<{
        counterType: string;
        total: number;
        periodStart: string | null;
    }>>;
    private normalizeErrorEventListQuery;
    private parseOptionalDate;
    private normalizeInteger;
}
export {};
//# sourceMappingURL=service.d.ts.map