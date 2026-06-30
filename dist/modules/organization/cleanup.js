/** Retention windows (days) for the daily purge pass. */
export const CLEANUP_RETENTION = {
    /** Terminal (expired/revoked/declined) invitations are deleted after this. */
    invitationDays: 90,
    /** Successfully-sent outbox rows are deleted after this. */
    emailSentDays: 14,
    /** Permanently-failed outbox rows are kept a bit longer for debugging. */
    emailFailedDays: 30,
};
/**
 * Hourly pass: time-sensitive state transitions. Each step is independent, so a
 * failure in one is logged and does not abort the others.
 */
export async function runHourlyOrgCleanup(repo, log) {
    const start = Date.now();
    const result = {
        invitationsExpired: 0,
        apiKeysRevoked: 0,
        scimTokensRevoked: 0,
        durationMs: 0,
    };
    try {
        result.invitationsExpired = await repo.expireStalePendingInvitations();
    }
    catch (err) {
        log.error({ err }, 'org cleanup: expireStalePendingInvitations failed');
    }
    try {
        result.apiKeysRevoked = await repo.revokeExpiredApiKeys();
    }
    catch (err) {
        log.error({ err }, 'org cleanup: revokeExpiredApiKeys failed');
    }
    try {
        result.scimTokensRevoked = await repo.revokeExpiredScimTokens();
    }
    catch (err) {
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
export async function runDailyOrgCleanup(repo, log) {
    const start = Date.now();
    const result = {
        invitationsPurged: 0,
        sentEmailsPurged: 0,
        failedEmailsPurged: 0,
        auditLogsPurged: 0,
        durationMs: 0,
    };
    try {
        result.invitationsPurged = await repo.purgeTerminalInvitations(CLEANUP_RETENTION.invitationDays);
    }
    catch (err) {
        log.error({ err }, 'org cleanup: purgeTerminalInvitations failed');
    }
    try {
        result.sentEmailsPurged = await repo.purgeSentEmailOutbox(CLEANUP_RETENTION.emailSentDays);
    }
    catch (err) {
        log.error({ err }, 'org cleanup: purgeSentEmailOutbox failed');
    }
    try {
        result.failedEmailsPurged = await repo.purgeFailedEmailOutbox(CLEANUP_RETENTION.emailFailedDays);
    }
    catch (err) {
        log.error({ err }, 'org cleanup: purgeFailedEmailOutbox failed');
    }
    try {
        result.auditLogsPurged = await repo.purgeExpiredAuditLogs();
    }
    catch (err) {
        log.error({ err }, 'org cleanup: purgeExpiredAuditLogs failed');
    }
    result.durationMs = Date.now() - start;
    log.info(result, 'org cleanup: daily pass complete');
    return result;
}
//# sourceMappingURL=cleanup.js.map