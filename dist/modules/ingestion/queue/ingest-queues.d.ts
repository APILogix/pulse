import { type SdkEventType } from '../pipeline/event-normalizer.js';
export declare const INGEST_QUEUE_PREFIX = "ingest_";
export declare const INGEST_QUEUES: Record<SdkEventType, string>;
export declare const QUEUE_TO_EVENT_TYPE: ReadonlyMap<string, SdkEventType>;
export declare const ALL_INGEST_QUEUES: readonly string[];
/** Shared dead-letter intake queue for every ingest_* queue. */
export declare const INGEST_DLQ_INTAKE_QUEUE = "ingest_dlq";
/** Singleton cron queue driving the org/project usage rollup. */
export declare const INGEST_USAGE_ROLLUP_QUEUE = "ingest_usage_rollup";
export declare function ingestQueueFor(eventType: SdkEventType): string;
export type PlanTier = 'free' | 'starter' | 'growth' | 'business' | 'enterprise';
export declare const PLAN_TIERS: readonly PlanTier[];
/** Plan weight dominates priority: a higher tier ALWAYS outranks a lower one. */
export declare const PLAN_WEIGHT: Record<PlanTier, number>;
/** Type urgency breaks ties within a tier: actionable signals first. */
export declare const TYPE_URGENCY: Record<SdkEventType, number>;
/**
 * Per-org in-flight budget per worker process, by plan tier.
 */
export declare const TENANT_INFLIGHT_LIMIT: Record<PlanTier, number>;
/** Priority boost granted per fairness deferral so aged jobs win eventually. */
export declare const FAIRNESS_AGE_BOOST = 25;
export declare function normalizePlanTier(raw: unknown): PlanTier;
export declare function jobPriority(planTier: PlanTier, eventType: SdkEventType, deferCount?: number): number;
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
    /** Total serialized byte size of the batch events. */
    batchBytes?: number | undefined;
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
/**
 * Provision all ingestion pgmq queues on Supabase.
 * Idempotent, robust against concurrent multi-process starts, pre-existing queues,
 * and sequence-to-extension membership collisions.
 */
export declare function provisionIngestQueues(): Promise<void>;
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
export declare function enqueueIngestJobs(jobs: Array<{
    queue: string;
    payload: IngestJobPayload;
    priority?: number;
}>): Promise<EnqueueResult>;
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
    dlqPerQueue: Array<{
        queue: string;
        count: number;
    }>;
}
export declare function createEmptyQueueDepthSnapshot(): IngestQueueDepthSnapshot;
/**
 * Queue depth probe reading PGMQ telemetry.
 */
export declare function ingestQueueDepth(pool?: {
    query: (sql: string, params?: unknown[]) => Promise<{
        rows: any[];
    }>;
}): Promise<IngestQueueDepthSnapshot>;
//# sourceMappingURL=ingest-queues.d.ts.map