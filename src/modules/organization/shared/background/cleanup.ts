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
export const CLEANUP_RETENTION = {
  /** Terminal (expired/revoked/declined) invitations are deleted after this. */
  invitationDays: 90,
  /** Successfully-sent outbox rows are deleted after this. */
  emailSentDays: 14,
  /** Permanently-failed outbox rows are kept a bit longer for debugging. */
  emailFailedDays: 30,
} as const;

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
export async function runHourlyOrgCleanup(
  repo: OrganizationRepository,
  log: FastifyBaseLogger,
): Promise<HourlyCleanupResult> {
  const start = Date.now();
  const result: HourlyCleanupResult = {
    invitationsExpired: 0,

    scimTokensRevoked: 0,
    durationMs: 0,
  };

  try {
    result.invitationsExpired = await repo.expireStalePendingInvitations();
  } catch (err) {
    log.error({ err }, 'org cleanup: expireStalePendingInvitations failed');
  }

  try {
    result.scimTokensRevoked = await repo.revokeExpiredScimTokens();
  } catch (err) {
    log.error({ err }, 'org cleanup: revokeExpiredScimTokens failed');
  }

  result.durationMs = Date.now() - start;
  log.info(result, 'org cleanup: hourly pass complete');
  return result;
}

/**
 * Daily pass: bounded purges of terminal rows. Audit-log retention is enforced
 * per-org from organization_settings.audit_log_retention_days (sensitive logs
 * are never purged).
 */
export async function runDailyOrgCleanup(
  repo: OrganizationRepository,
  log: FastifyBaseLogger,
): Promise<DailyCleanupResult> {
  const start = Date.now();
  const result: DailyCleanupResult = {
    invitationsPurged: 0,
    sentEmailsPurged: 0,
    failedEmailsPurged: 0,
    auditLogsPurged: 0,
    durationMs: 0,
  };

  try {
    result.invitationsPurged = await repo.purgeTerminalInvitations(CLEANUP_RETENTION.invitationDays);
  } catch (err) {
    log.error({ err }, 'org cleanup: purgeTerminalInvitations failed');
  }
  try {
    result.sentEmailsPurged = await repo.purgeSentEmailOutbox(CLEANUP_RETENTION.emailSentDays);
  } catch (err) {
    log.error({ err }, 'org cleanup: purgeSentEmailOutbox failed');
  }
  try {
    result.failedEmailsPurged = await repo.purgeFailedEmailOutbox(CLEANUP_RETENTION.emailFailedDays);
  } catch (err) {
    log.error({ err }, 'org cleanup: purgeFailedEmailOutbox failed');
  }
  try {
    result.auditLogsPurged = await repo.purgeExpiredAuditLogs();
  } catch (err) {
    log.error({ err }, 'org cleanup: purgeExpiredAuditLogs failed');
  }

  result.durationMs = Date.now() - start;
  log.info(result, 'org cleanup: daily pass complete');
  return result;
}
