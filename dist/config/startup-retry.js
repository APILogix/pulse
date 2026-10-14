import { env } from './env.js';
import { isTransientPostgresError } from './postgres-ssl.js';
/**
 * Runs a required startup check with a small, bounded retry budget.
 *
 * Only transport-level PostgreSQL failures are retried. Authentication, TLS,
 * configuration, and SQL failures remain fail-fast so a bad deployment is
 * never obscured as a transient outage.
 */
export async function retryTransientStartupOperation(operation, connect, options = {}) {
    const maxAttempts = options.maxAttempts ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 500;
    const maxDelayMs = options.maxDelayMs ?? Number.POSITIVE_INFINITY;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await connect();
        }
        catch (error) {
            if (attempt >= maxAttempts || !isTransientPostgresError(error)) {
                throw error;
            }
            const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
            options.onRetry?.({ operation, attempt, maxAttempts, delayMs, error });
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    throw new Error(`Startup connection retry exhausted for ${operation}`);
}
/** Apply the single configured startup policy used by every PostgreSQL process. */
export function retryConfiguredStartupOperation(operation, connect, log) {
    return retryTransientStartupOperation(operation, connect, {
        maxAttempts: env.STARTUP_DB_RETRY_MAX_ATTEMPTS,
        baseDelayMs: env.STARTUP_DB_RETRY_BASE_DELAY_MS,
        maxDelayMs: env.STARTUP_DB_RETRY_MAX_DELAY_MS,
        onRetry: ({ attempt, maxAttempts, delayMs, error }) => {
            log.warn({ err: error, operation, attempt, maxAttempts, delayMs }, 'Transient database startup connection failure; retrying');
        },
    });
}
//# sourceMappingURL=startup-retry.js.map