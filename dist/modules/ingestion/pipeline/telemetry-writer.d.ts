import type { Pool } from 'pg';
import type { NormalizedEvent } from './event-normalizer.js';
/** An event paired with the tenant context resolved from its API key. */
export interface ScopedEvent {
    projectId: string;
    /** Organization id — REQUIRED for events_* (organization_id is NOT NULL). */
    orgId: string | null;
    event: NormalizedEvent;
}
/** Storage error_name for an error event (shared with the error grouper). */
export declare function errorNameOf(event: NormalizedEvent): string;
/**
 * Storage fingerprint for an error event (shared with the error grouper so
 * events_errors.fingerprint and analytics_error_groups.fingerprint agree).
 */
export declare function errorFingerprint(event: NormalizedEvent, errorName?: string): string;
/** Result of writing one event type. */
export interface TypedWriteResult {
    /** Rows ACTUALLY inserted (delivery duplicates excluded). */
    inserted: number;
    /** Error events confirmed inserted — only set by the errors writer. */
    insertedErrors?: ScopedEvent[];
}
/** Per-batch write outcome with duplicate-aware counts. */
export interface DetailedWriteResult {
    /** Input rows that had a resolvable organization_id. */
    totalReceived: number;
    /** Rows actually inserted across all events_* tables. */
    totalInserted: number;
    perType: Record<string, {
        received: number;
        inserted: number;
    }>;
    /** Error events confirmed inserted (drives analytics_error_groups). */
    insertedErrors: ScopedEvent[];
}
export declare class TelemetryWriter {
    private readonly pool;
    constructor(pool: Pool);
    /**
     * Route a batch of scoped events to the correct events_* table(s). Mixed
     * types are grouped so each table gets one multi-row insert. Events without a
     * resolvable organization_id are skipped (events_* requires it) and counted
     * out of the return total.
     *
     * Returns the number of rows ACTUALLY inserted (delivery duplicates dropped
     * by ON CONFLICT DO NOTHING are excluded). Kept for legacy callers — new
     * code should use writeBatchDetailed().
     */
    writeBatch(scoped: ScopedEvent[]): Promise<number>;
    /**
     * writeBatch with the full outcome: per-type received/inserted counts and
     * the error events confirmed inserted (for analytics_error_groups). The
     * inserted counts drive usage accounting, so duplicates delivered by
     * at-least-once retries are never billed twice.
     */
    writeBatchDetailed(scoped: ScopedEvent[]): Promise<DetailedWriteResult>;
    private writeTyped;
    /** Best-effort event id (events_*.event_id is NOT NULL). */
    private eventId;
    private writeErrors;
    private writeMessages;
    private writeRequests;
    private writeSpans;
    private writeTraces;
    private writeMetrics;
    private writeLogs;
    private writeProfiles;
    private writeCronCheckins;
    private writeReplays;
}
//# sourceMappingURL=telemetry-writer.d.ts.map