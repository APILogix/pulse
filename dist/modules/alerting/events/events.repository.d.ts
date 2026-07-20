/**
 * Alerting persistence layer.
 *
 * Owns all SQL for the alerting module. Tenant isolation is enforced in the
 * service layer by always passing `organization_id` into queries (this
 * codebase isolates tenants in the application layer — see migration 003).
 *
 * Performance contract for the batch worker:
 *   - `getBatchWithEvents` fetches a batch + its events in ONE query.
 *   - `bulkUpdateEventStatus` / `bulkInsertDeliveryAttempts` use UNNEST-based
 *     set operations — NO per-row (N+1) writes.
 */
import type { PoolClient } from 'pg';
import { type AlertBatchRow, type AlertDeadLetterRow, type AlertDeliveryAttemptRow, type AlertEventRow, type AlertEventStatus, type AlertThrottleWindowRow, type DeliveryAttemptStatus, type ListDeadLettersQuery, type ListEventsQuery } from '../types.js';
export interface InsertEventInput {
    organizationId: string;
    ruleId: string | null;
    /** Optional project scope (null = org-level event). */
    projectId: string | null;
    status: AlertEventStatus;
    severity: string;
    fingerprint: string;
    source: string;
    sourceId: string | null;
    payload: Record<string, unknown>;
    normalizedPayload: Record<string, unknown> | null;
    labels: Record<string, unknown>;
    annotations: Record<string, unknown>;
    autoResolveAt: Date | null;
}
export interface DeliveryAttemptInsert {
    organizationId: string;
    eventId: string;
    connectorId: string | null;
    routeId: string | null;
    batchId: string | null;
    status: DeliveryAttemptStatus;
    responseStatusCode: number | null;
    errorMessage: string | null;
    errorCategory: string | null;
    latencyMs: number | null;
    externalMessageId: string | null;
}
export declare class EventsRepository {
    private readonly db;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    /** Find an active (firing/acknowledged) event matching a fingerprint within the dedup window. */
    findActiveEventByFingerprint(organizationId: string, fingerprint: string, windowSeconds: number, projectId?: string | null): Promise<AlertEventRow | null>;
    incrementDuplicate(eventId: string): Promise<AlertEventRow>;
    insertEvent(input: InsertEventInput): Promise<AlertEventRow>;
    findEventById(organizationId: string, id: string): Promise<AlertEventRow | null>;
    listEvents(organizationId: string, query: ListEventsQuery): Promise<{
        data: AlertEventRow[];
        total: number;
    }>;
    acknowledgeEvent(organizationId: string, eventId: string, userId: string, expiresAt: Date | null, comment: string | null): Promise<AlertEventRow>;
    resolveEvent(organizationId: string, eventId: string, userId: string | null, reason: string, autoResolved: boolean): Promise<AlertEventRow>;
    insertHistory(input: {
        eventId: string;
        organizationId: string;
        action: string;
        actorId: string | null;
        actorType?: string;
        previousState?: Record<string, unknown> | null;
        newState?: Record<string, unknown> | null;
        changesSummary?: Record<string, unknown> | null;
        metadata?: Record<string, unknown>;
    }, client?: PoolClient): Promise<void>;
    getEventHistory(eventId: string): Promise<Array<Record<string, unknown>>>;
    getEventDeliveries(eventId: string): Promise<AlertDeliveryAttemptRow[]>;
    /**
     * Atomically claim up to `limit` pending events for the org and enqueue them
     * as a single batch. SKIP LOCKED makes concurrent batch creation safe.
     */
    createBatchFromPending(organizationId: string, limit: number, workerId: string): Promise<AlertBatchRow | null>;
    /** Fetch a batch and ALL its events in a single round-trip (no N+1). */
    getBatchWithEvents(batchId: string, organizationId: string): Promise<{
        batch: AlertBatchRow;
        events: AlertEventRow[];
    } | null>;
    completeBatch(batchId: string, counts: {
        success: number;
        failure: number;
        skipped: number;
    }, durationMs: number, status: 'completed' | 'partial' | 'failed', errorMessage: string | null): Promise<void>;
    /**
     * Bulk-update event statuses in ONE statement via UNNEST. `last_notified_at`
     * is set for events that were delivered (status 'firing'). Escalation columns
     * are only overwritten when the caller provides a non-null value (COALESCE),
     * so non-escalating status changes leave escalation state untouched.
     */
    bulkUpdateEventStatus(organizationId: string, updates: Array<{
        id: string;
        status: AlertEventStatus;
        escalationPolicyId?: string | null;
        escalationStepNumber?: number | null;
        nextEscalationAt?: Date | null;
    }>): Promise<void>;
    /** Bulk-insert delivery attempts in ONE statement via UNNEST. */
    bulkInsertDeliveryAttempts(rows: DeliveryAttemptInsert[]): Promise<void>;
    /** Distinct org ids that currently have pending (un-batched) events. */
    findOrgsWithPendingEvents(limit: number): Promise<string[]>;
    claimAutoResolvable(limit: number): Promise<AlertEventRow[]>;
    /**
     * Claim firing events whose next escalation step is due. SKIP LOCKED makes
     * concurrent sweep workers safe — no two workers process the same event.
     */
    claimEscalationDue(limit: number): Promise<AlertEventRow[]>;
    /** Advance an event to a given escalation step and schedule the next run (or stop). */
    advanceEscalation(eventId: string, stepNumber: number, repeatCount: number, nextEscalationAt: Date | null): Promise<void>;
    /**
     * Flip expired acknowledgments back to firing so escalation resumes.
     * Returns the affected rows (already locked + transitioned in one statement).
     */
    resumeExpiredAcknowledgments(limit: number): Promise<AlertEventRow[]>;
    /**
     * Requeue events stuck in 'processing' for longer than `staleMinutes`
     * (worker crash or pg-boss job expiry) back to 'pending'. SKIP LOCKED on the
     * claim; the UPDATE is idempotent because it only touches rows still in
     * 'processing'.
     */
    requeueStuckProcessingEvents(staleMinutes: number, limit: number): Promise<AlertEventRow[]>;
    /** Fail batches stuck in 'processing' for longer than `staleMinutes`. */
    failStaleBatches(staleMinutes: number): Promise<number>;
    setBatchJobId(batchId: string, jobId: string | null): Promise<void>;
    /** Fetch current-hour throttle windows for the given rule actions (one query). */
    getThrottleStates(actionIds: string[]): Promise<AlertThrottleWindowRow[]>;
    /** Increment the current-hour window for each action (bulk upsert). */
    recordThrottleNotifications(actionIds: string[]): Promise<void>;
    insertDeadLetter(input: {
        organizationId: string;
        sourceQueue: string;
        pgBossJobId: string | null;
        batchId: string | null;
        eventIds: string[];
        jobPayload: Record<string, unknown>;
        errorMessage: string | null;
        maxRetries: number;
    }): Promise<AlertDeadLetterRow>;
    listDeadLetters(organizationId: string, query: ListDeadLettersQuery): Promise<{
        data: AlertDeadLetterRow[];
        total: number;
    }>;
    findDeadLetterById(organizationId: string, id: string): Promise<AlertDeadLetterRow | null>;
    /** Retryable dead letters for the scheduled retry sweep (SKIP LOCKED claim). */
    claimRetryableDeadLetters(limit: number): Promise<AlertDeadLetterRow[]>;
    markDeadLetterRetried(id: string): Promise<void>;
    markDeadLetterExhausted(id: string): Promise<void>;
    discardDeadLetter(organizationId: string, id: string, userId: string): Promise<void>;
    /** Purge resolved/suppressed/silenced events older than `days` (history + deliveries cascade). */
    purgeOldTerminalEvents(days: number): Promise<number>;
    purgeOldBatches(days: number): Promise<number>;
    purgeOldDeliveryAttempts(days: number): Promise<number>;
    purgeOldDeadLetters(days: number): Promise<number>;
    purgeOldThrottleWindows(): Promise<number>;
}
//# sourceMappingURL=events.repository.d.ts.map