import type { Pool } from 'pg';
import { PostgresWriter } from './postgress.writter.js';
import type { IngestRequest, IngestResponse, ErrorEventListQuery, ErrorEventListResult, ErrorEventRecord, ReplayRequest, HealthStatus, SDKInitResponse } from './types.js';
interface BackpressureConfig {
    readonly highWater: number;
    readonly criticalWater: number;
    readonly shedLowPriorityAt: number;
    readonly shedNormalPriorityAt: number;
}
interface ServiceConfig {
    maxBatchSize: number;
    defaultRateLimitPerSecond: number;
    defaultRateLimitPerMinute: number;
    /** Override defaults via env without touching code. */
    backpressure?: BackpressureConfig;
    replayMaxEvents?: number;
}
export declare class IngestionService {
    private readonly pool;
    private readonly writer;
    private readonly queue;
    private readonly rateLimiter;
    private readonly backpressure;
    private readonly replayMaxEvents;
    private readonly maxBatchSize;
    private readonly defaultRatePerSecond;
    private readonly defaultRatePerMinute;
    private cachedDepth;
    private cachedDepthAt;
    constructor(pool: Pool, writer: PostgresWriter, config: ServiceConfig);
    private resolveProject;
    /** Cached pending-depth probe (refreshed at most every 2s). */
    private pendingDepth;
    /** Decide whether to shed an event given current queue pressure. */
    private shouldShed;
    initializeSdk(apiKey: string): Promise<SDKInitResponse>;
    ingestBatch(req: IngestRequest, apiKey: string): Promise<IngestResponse>;
    ingestRequests(req: IngestRequest, apiKey: string): Promise<IngestResponse>;
    ingestErrors(req: IngestRequest, apiKey: string): Promise<IngestResponse>;
    ingestLogs(req: IngestRequest, apiKey: string): Promise<IngestResponse>;
    ingestMetrics(req: IngestRequest, apiKey: string): Promise<IngestResponse>;
    /**
     * Central pipeline. `expectedType` (when set) enforces a typed route — every
     * event must match it or be rejected.
     */
    private processIngest;
    /** Best-effort stable id for a single event in a batch. */
    private extractEventId;
    getHealth(): Promise<HealthStatus>;
    getIngestionHealth(): Promise<unknown>;
    getLimits(apiKey: string): Promise<{
        perSecond: number;
        perMinute: number;
        maxBatchSize: number;
    }>;
    /**
     * Paginated listing of dead-lettered jobs. Uses bounded offset/limit with
     * defensive validation: callers may pass arbitrary integers; we clamp them
     * before they touch the SQL.
     */
    getDLQJobs(offset?: number, limit?: number): Promise<unknown[]>;
    reprocessDLQJob(jobId: string): Promise<void>;
    reprocessAllDLQ(batchSize?: number): Promise<number>;
    /**
     * Replay historical telemetry by re-enqueuing it through the standard worker
     * path. Capped by INGESTION_REPLAY_MAX_EVENTS to prevent operator typos from
     * flooding the queue.
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
    private normalizeErrorEventListQuery;
    private parseOptionalDate;
    private normalizeInteger;
}
export {};
//# sourceMappingURL=service.d.ts.map