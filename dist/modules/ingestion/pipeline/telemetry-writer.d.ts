import type { Pool } from 'pg';
import type { NormalizedEvent } from './event-normalizer.js';
/** An event paired with the tenant context resolved from its API key. */
export interface ScopedEvent {
    projectId: string;
    /** Organization id — REQUIRED for events_* (organization_id is NOT NULL). */
    orgId: string | null;
    event: NormalizedEvent;
}
export declare class TelemetryWriter {
    private readonly pool;
    constructor(pool: Pool);
    /**
     * Route a batch of scoped events to the correct events_* table(s). Mixed
     * types are grouped so each table gets one multi-row insert. Events without a
     * resolvable organization_id are skipped (events_* requires it) and counted
     * out of the return total.
     */
    writeBatch(scoped: ScopedEvent[]): Promise<number>;
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