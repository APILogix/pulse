/**
 * ============================================================================
 * LEGACY — DISABLED. RETAINED FOR REFERENCE ONLY. DO NOT WIRE.
 * ----------------------------------------------------------------------------
 * This is the PREVIOUS TelemetryWriter implementation that persisted normalized
 * events into the legacy `migrations/013-014` telemetry tables
 * (`errors`, `requests`, `metrics`, `spans`, `traces`, `logs`, `profiles`,
 * `cron_checkins`, `replays`, `messages`).
 *
 * It has been SUPERSEDED by the new TelemetryWriter (telemetry-writer.ts),
 * which writes into the authoritative migrations2/004 `events_*` schema that
 * the analytics + event-analytics modules actually read from. Those legacy
 * tables are outdated and no longer queried, so ingesting into them produced
 * data that never reached analytics/alerting.
 *
 * Nothing imports this file. It is kept (instead of deleted) so the prior
 * column mappings remain available during the migration window.
 * ============================================================================
 */
import type { Pool } from 'pg';
import type { NormalizedEvent } from './event-normalizer.js';
/** An event paired with the tenant context resolved from its API key. */
export interface LegacyScopedEvent {
    projectId: string;
    orgId: string | null;
    event: NormalizedEvent;
}
export declare class LegacyTelemetryWriter {
    private readonly pool;
    constructor(pool: Pool);
    writeBatch(scoped: LegacyScopedEvent[]): Promise<number>;
    private writeTyped;
    private writeSpans;
    private writeMetrics;
    private writeLogs;
    private writeCronCheckins;
    private writeReplays;
    private writeMessages;
}
//# sourceMappingURL=telemetry-writer.legacy.d.ts.map