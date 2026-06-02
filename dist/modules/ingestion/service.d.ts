/**
 * Ingestion business service.
 *
 * End-to-end flow:
 * 1. Hash the SDK API key and resolve the owning project from Redis first, then
 *    Postgres on cache miss.
 * 2. Enforce project status and per-project rate limits before accepting data.
 * 3. Validate batch size and event type permissions.
 * 4. Apply idempotency per event id to avoid duplicate queue work.
 * 5. Enrich accepted events with project/org/batch metadata and push them into
 *    the in-memory buffer for BullMQ delivery.
 *
 * This class owns ingestion policy, but it does not write events directly; the
 * worker side persists queued events through PostgresWriter.
 */
import { Queue, Job } from 'bullmq';
import { RedisCache } from '../../db/redis/cache.js';
import { PostgresWriter } from './postgress.writter.js';
import type { QuotaService } from '../billing/quota-service.js';
import type { IngestRequest, IngestResponse, ErrorEventListQuery, ErrorEventListResult, ErrorEventRecord, ReplayRequest, HealthStatus, SDKInitResponse } from './types.js';
export declare class IngestionService {
    private queue;
    private cache;
    private writer;
    private quotaService;
    private config;
    private buffer;
    private readonly circuitThreshold;
    constructor(queue: Queue, cache: RedisCache, writer: PostgresWriter, quotaService: QuotaService | undefined, config: {
        maxBatchSize: number;
        defaultRateLimitPerSecond: number;
        defaultRateLimitPerMinute: number;
    });
    /**
     * Resolve project by API key.
     * Redis cache first -> Postgres fallback -> Cache fill
     */
    private resolveProject;
    /** Initialize SDK — Returns exact contract your SDK expects */
    initializeSdk(apiKey: string): Promise<SDKInitResponse>;
    /** Main batch ingestion */
    ingestBatch(req: IngestRequest): Promise<IngestResponse>;
    /** Typed endpoints */
    ingestRequests(req: IngestRequest): Promise<IngestResponse>;
    ingestErrors(req: IngestRequest): Promise<IngestResponse>;
    ingestLogs(req: IngestRequest): Promise<IngestResponse>;
    ingestMetrics(req: IngestRequest): Promise<IngestResponse>;
    /** Central processing pipeline */
    private processIngest;
    getHealth(): Promise<HealthStatus>;
    getIngestionHealth(): Promise<any>;
    getLimits(apiKey: string): Promise<{
        perSecond: number;
        perMinute: number;
        maxBatchSize: number;
    }>;
    getDLQJobs(start?: number, end?: number): Promise<Job[]>;
    reprocessDLQJob(jobId: string): Promise<void>;
    reprocessAllDLQ(batchSize?: number): Promise<number>;
    replayEvents(req: ReplayRequest): Promise<{
        replayId: string;
        queued: number;
    }>;
    listErrors(query: ErrorEventListQuery): Promise<ErrorEventListResult>;
    getErrorById(errorId: string, projectId: string): Promise<ErrorEventRecord | null>;
    getDebugEvent(eventId: string, projectId: string): Promise<any>;
    shutdown(): Promise<void>;
    private normalizeErrorEventListQuery;
    private parseOptionalDate;
    private normalizeInteger;
}
//# sourceMappingURL=service.d.ts.map