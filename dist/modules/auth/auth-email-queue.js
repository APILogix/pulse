import { pgboss } from '../../lib/pgboss.js';
import { logger } from '../../config/logger.js';
const log = logger.child({ component: 'auth-email-queue' });
export const AUTH_EMAIL_QUEUE = 'auth.email';
/**
 * Enqueues an auth email to be sent asynchronously by the worker.
 * Provides safe retries, exponential backoff, and idempotency guarantees.
 */
export async function enqueueAuthEmailJob(message) {
    // Using pgboss to enqueue.
    // retryLimit: 5 means it will attempt up to 6 times total
    // retryBackoff: true uses exponential backoff
    const jobId = await pgboss.send(AUTH_EMAIL_QUEUE, message, {
        retryLimit: 5,
        retryBackoff: true,
        expireInSeconds: 60 * 5, // Job is allowed 5 mins to run before timeout
    });
    if (jobId) {
        log.debug({ jobId, to: message.to }, 'Auth email job enqueued');
    }
    else {
        log.error({ to: message.to }, 'Failed to enqueue auth email job');
    }
}
//# sourceMappingURL=auth-email-queue.js.map