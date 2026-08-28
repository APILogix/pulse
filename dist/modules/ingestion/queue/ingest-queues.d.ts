import type { SdkEventType } from '../pipeline/event-normalizer.js';
export declare const INGEST_QUEUE_PREFIX = "ingest.";
export declare const INGEST_QUEUES: Record<SdkEventType, string>;
export declare const ALL_INGEST_QUEUES: readonly string[];
/** Shared dead-letter intake queue for every ingest.* queue. */
export declare const INGEST_DLQ_INTAKE_QUEUE = "ingest.dlq-intake";
/** Singleton cron queue driving the org/project usage rollup. */
export declare const INGEST_USAGE_ROLLUP_QUEUE = "ingest.usage-rollup";
export declare function ingestQueueFor(eventType: SdkEventType): string;
export type PlanTier = 'free' | 'starter' | 'growth' | 'business' | 'enterprise';
export declare const PLAN_TIERS: readonly PlanTier[];
/** Plan weight dominates priority: a higher tier ALWAYS outranks a lower one. */
export declare const PLAN_WEIGHT: Record<PlanTier, number>;
/** Type urgency breaks ties within a tier: actionable signals first. */
export declare const TYPE_URGENCY: Record<SdkEventType, number>;
/**
 * Per-org in-flight budget per worker process, by plan tier. This is the
 * tenant-fairness knob: within a tier, one org may hold at most this many
 * concurrently processing jobs before its jobs are deferred (aged) so other
 * tenants' jobs run first.
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
    /** Original ingest.* queue the job failed in. */
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
export declare function ingestQueueOptions(): Record<string, unknown>;
/**
 * Create one queue. pg-boss v12 uses INSERT ... ON CONFLICT DO NOTHING, so an
 * existing queue is a successful no-op. Unexpected provisioning failures must
 * propagate; swallowing them leaves workers "started" without usable queues.
 */
export declare function safeCreateQueue(name: string, options?: Record<string, unknown>): Promise<void>;
/** Provision the DLQ first, then its source queues, then the rollup queue. */
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
 * Enqueue a tenant-scoped batch as one pg-boss job per (type, chunk). Uses the
 * v12 bulk `insert` when available, falling back to per-job `send`.
 *
 * Durability contract: once this resolves, events survive a crash of any
 * process. That is the ONLY hard work the gateway is allowed to do.
 */
export declare function enqueueIngestJobs(jobs: Array<{
    queue: string;
    payload: IngestJobPayload;
    priority: number;
}>): Promise<EnqueueResult>;
export interface IngestQueueDepthSnapshot {
    /** Jobs waiting to be picked up (created + retry) across all ingest queues. */
    pending: number;
    /** Pending/retry jobs that are runnable now (start_after <= now). */
    ready: number;
    /** Pending/retry jobs delayed by retry/fairness scheduling (start_after > now). */
    deferred: number;
    /** Jobs currently being processed. */
    active: number;
    /** Failed jobs (pre-dead-letter). */
    failed: number;
    /** Persisted, unreplayed DLQ rows across all ingest queues. */
    deadLettered: number;
    /** Age of the oldest pending/retry job across all ingest queues. */
    oldestPendingAgeMs: number | null;
    perQueue: Array<{
        queue: string;
        state: string;
        count: number;
        ready: number;
        deferred: number;
        oldestPendingAgeMs: number | null;
    }>;
    dlqPerQueue: Array<{
        queue: string;
        count: number;
    }>;
}
/**
 * Queue depth probe. pg-boss v12 exposes no public size API, so we read the
 * job table directly — one partition-pruned grouped scan.
 *
 * This runs on the CONTENDED control pool, so its cost and frequency both
 * matter. Callers cache the result (gateway: INGESTION_QUEUE_DEPTH_CACHE_MS,
 * metrics server: DEPTH_CACHE_MS) so the request path stays O(1) and never
 * awaits this probe.
 */
export declare function ingestQueueDepth(pool: {
    query: (sql: string, params?: unknown[]) => Promise<{
        rows: Array<{
            name: string;
            state: string;
            n: number;
            ready: number;
            deferred: number;
            oldest_pending_age_ms: number | string | null;
        } | {
            queue: string;
            n: number;
        }>;
    }>;
}): Promise<IngestQueueDepthSnapshot>;
//# sourceMappingURL=ingest-queues.d.ts.map