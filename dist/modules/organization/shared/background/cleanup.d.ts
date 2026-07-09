/**
 * Organization cleanup / housekeeping logic.
 *
 * Pure orchestration over OrganizationRepository bulk-sweep methods. This module
 * holds NO scheduling concern — it is invoked by the pg-boss cron handlers
 * registered in ./queue.ts (which run in the worker / standalone-cron process).
 *
 * Two cadences:
 *   - hourly: cheap, time-sensitive state moves (expire stale invitations,
 *     revoke expired API keys / SCIM tokens). Keeps security posture tight.
 *   - daily:  bounded purges of terminal rows (old invitations, drained email
 *     outbox, audit logs past each org's configured retention).
 *
 * No Redis is involved anywhere; coordination/single-execution is provided by
 * pg-boss schedules on top of Postgres.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { OrganizationRepository } from '../../repository.js';
/** Retention windows (days) for the daily purge pass. */
export declare const CLEANUP_RETENTION: {
    /** Terminal (expired/revoked/declined) invitations are deleted after this. */
    readonly invitationDays: 90;
    /** Successfully-sent outbox rows are deleted after this. */
    readonly emailSentDays: 14;
    /** Permanently-failed outbox rows are kept a bit longer for debugging. */
    readonly emailFailedDays: 30;
};
export interface HourlyCleanupResult {
    invitationsExpired: number;
    scimTokensRevoked: number;
    durationMs: number;
}
export interface DailyCleanupResult {
    invitationsPurged: number;
    sentEmailsPurged: number;
    failedEmailsPurged: number;
    auditLogsPurged: number;
    durationMs: number;
}
/**
 * Hourly pass: time-sensitive state transitions. Each step is independent, so a
 * failure in one is logged and does not abort the others.
 */
export declare function runHourlyOrgCleanup(repo: OrganizationRepository, log: FastifyBaseLogger): Promise<HourlyCleanupResult>;
/**
 * Daily pass: bounded purges of terminal rows. Audit-log retention is enforced
 * per-org from organization_settings.audit_log_retention_days (sensitive logs
 * are never purged).
 */
export declare function runDailyOrgCleanup(repo: OrganizationRepository, log: FastifyBaseLogger): Promise<DailyCleanupResult>;
//# sourceMappingURL=cleanup.d.ts.map