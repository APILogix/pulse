/**
 * TelemetryWriter — persists normalized events to their typed, partitioned
 * tables (migration 013). One method per signal family; all writes are
 * tenant-scoped (project_id/org_id come from the authenticated API key, NEVER
 * from the event payload — defends cross-tenant ingestion / project spoofing).
 *
 * Batching: each method accepts an array and does a single multi-row insert per
 * call so the worker can flush a claimed batch in one round trip per type.
 * Inserts are best-effort idempotent where a natural key exists (traces).
 */
import type { Pool } from 'pg';
import type { NormalizedEvent } from './event-normalizer.js';
/** An event paired with the tenant context resolved from its API key. */
export interface ScopedEvent {
    projectId: string;
    orgId: string | null;
    event: NormalizedEvent;
}
export declare class TelemetryWriter {
    private readonly pool;
    constructor(pool: Pool);
    /**
     * Route a batch of scoped events to the correct table(s). Events of mixed
     * types are grouped so each table gets one insert. Returns count persisted.
     */
    writeBatch(scoped: ScopedEvent[]): Promise<number>;
    private writeTyped;
    private writeSpans;
    private writeTraces;
    private writeMetrics;
    private writeLogs;
    private writeProfiles;
    private writeCronCheckins;
    private writeReplays;
    private writeMessages;
    /**
     * Errors are persisted to the partitioned `errors` table and rolled up into
     * `error_groups` for analytics. Both project_id and org_id come from the
     * authenticated API key, never the payload.
     *
     * Performance note: The original implementation inserted one row at a time
     * AND issued a separate fingerprint-rollup statement per event. At high
     * error rates that doubles round trips per event and exhausts the pool.
     * This version uses one multi-row INSERT for the canonical errors table
     * and a single multi-row UPSERT for the rollup, both inside the same call
     * stack. The rollup is still best-effort: if it fails, the durable error
     * write has already committed.
     */
    private writeErrors;
    private writeRequests;
}
//# sourceMappingURL=telemetry-writer.d.ts.map