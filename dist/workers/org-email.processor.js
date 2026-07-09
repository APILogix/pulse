import { logger } from '../config/logger.js';
import { processOrgEmailOutbox } from '../modules/organization/shared/background/email-outbox.js';
const workerLogger = logger.child({ component: 'org-email-worker' });
let isRunning = false;
let timeoutId = null;
const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 5000;
/**
 * Worker polling loop for organization_email_outbox.
 *
 * Drains due org/project emails (invitations, member lifecycle, quota
 * decisions, latency alerts) with retry + backoff. When a full batch is
 * processed we loop immediately, otherwise we wait POLL_INTERVAL_MS.
 */
async function pollOrgEmailOutbox() {
    if (!isRunning)
        return;
    try {
        const sent = await processOrgEmailOutbox(BATCH_SIZE);
        if (sent === BATCH_SIZE) {
            timeoutId = setTimeout(pollOrgEmailOutbox, 0);
            return;
        }
    }
    catch (error) {
        workerLogger.error({ err: error }, 'Error in org email polling loop');
    }
    timeoutId = setTimeout(pollOrgEmailOutbox, POLL_INTERVAL_MS);
}
/** Starts the org email worker polling loop. */
export async function startOrgEmailWorker() {
    if (isRunning)
        return;
    isRunning = true;
    workerLogger.info('Starting org email polling worker...');
    pollOrgEmailOutbox();
}
/** Stops the org email worker polling loop cleanly. */
export function stopOrgEmailWorker() {
    if (!isRunning)
        return;
    isRunning = false;
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
    workerLogger.info('Org email polling worker stopped.');
}
//# sourceMappingURL=org-email.processor.js.map