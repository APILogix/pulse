/**
 * AlertDomainOutboxRelay — relays alert lifecycle domain events (fired/resolved)
 * from the outbox into automation.
 *
 * Architecture: docs/automationv2/27-alerting-automation-event-contract.md
 *
 * Mirrors TelemetryOutboxRelay's claim/publish/mark pattern exactly (same
 * FOR UPDATE SKIP LOCKED claim shape, same markPublished/markFailed split), but
 * claims a DISJOINT row set: `signal_kind = 'alert_domain_event'` only. The two
 * relays share the underlying `telemetry_outbox` table (see the storage-quota
 * rationale in the migration comment and the event-contract doc) but never
 * compete for the same row, because TelemetryOutboxRelay's own claim filters
 * `fast_path = TRUE` and every row this relay writes has `fast_path = FALSE`.
 *
 * Publishes a pg-boss job (`automation-ingest.alert-domain-event`) that a
 * consumer registered in the AUTOMATION module picks up. This relay does not
 * import anything from src/modules/automation — the job name and payload shape
 * are the only contract between the two modules, exactly like every other
 * cross-module pg-boss handoff in this codebase.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
export declare const ALERT_DOMAIN_OUTBOX_JOB = "automation-ingest.alert-domain-event";
export interface AutomationAlertDomainEventJob {
    organizationId: string;
    projectId: string | null;
    eventType: 'alert.event.created' | 'alert.event.resolved';
    alertKey: string;
    alertEventId: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown>;
    occurredAt: string;
}
export declare class AlertDomainOutboxRelay {
    private readonly db;
    private readonly workerId;
    private readonly log;
    constructor(db: Pool, logger: FastifyBaseLogger);
    run(limit?: number): Promise<number>;
    private claim;
    private markPublished;
    private markFailed;
}
//# sourceMappingURL=alert-domain-outbox-relay.d.ts.map