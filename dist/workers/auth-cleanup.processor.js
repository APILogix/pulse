/**
 * Auth cleanup worker.
 *
 * Periodically:
 *   1. Marks expired sessions as `expired` (soft transition; keeps audit
 *      trail intact).
 *   2. Permanently deletes sessions that have been revoked or expired for
 *      longer than the retention window so the table does not grow without
 *      bound.
 *   3. Deletes consumed and expired email-flow tokens (verification +
 *      password reset).
 *
 * The worker is intentionally driven by a simple setInterval inside the
 * workers process. This avoids introducing a new BullMQ queue just for
 * housekeeping. If we later want distributed coordination, we can add a
 * Redis lock around runOnce.
 */
// import { processAuthEmailOutbox } from '../modules/auth/email-outbox.js';
import { processDueAccountDeletions } from '../modules/auth/application/services/identity.service.js';
import { cleanupExpiredSessions, deleteExpiredEmailMfaOtps, deleteExpiredEmailTokens, purgeOldRevokedSessions, } from '../modules/auth/infrastructure/repositories/index.js';
import { logger } from '../config/logger.js';
const log = logger.child({ component: 'auth-cleanup' });
const INTERVAL_MS = 60 * 60 * 1000; // hourly
const SESSION_RETENTION_DAYS = 90;
let runningTimer = null;
export async function runOnce() {
    const start = Date.now();
    try {
        const expired = await cleanupExpiredSessions();
        const purged = await purgeOldRevokedSessions(SESSION_RETENTION_DAYS);
        const tokens = await deleteExpiredEmailTokens();
        const emailMfaOtps = await deleteExpiredEmailMfaOtps();
        const scheduledDeletions = await processDueAccountDeletions();
        // const emailsSent = await processAuthEmailOutbox(); // Deprecated, handled by PgBoss
        log.info({
            expired,
            purged,
            tokens,
            emailMfaOtps,
            scheduledDeletions,
            durationMs: Date.now() - start,
        }, 'Auth cleanup pass complete');
    }
    catch (err) {
        log.error({ err }, 'Auth cleanup pass failed');
    }
}
export function startAuthCleanupWorker() {
    if (runningTimer)
        return;
    log.info({ intervalMs: INTERVAL_MS }, 'Starting auth cleanup worker');
    // Run once at startup and then on the schedule.
    void runOnce();
    runningTimer = setInterval(() => void runOnce(), INTERVAL_MS);
    runningTimer.unref();
}
export function stopAuthCleanupWorker() {
    if (runningTimer) {
        clearInterval(runningTimer);
        runningTimer = null;
    }
}
//# sourceMappingURL=auth-cleanup.processor.js.map