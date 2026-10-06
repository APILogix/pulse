import type { Logger } from 'pino';
export interface StartupRetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    /** Upper bound for a single backoff delay. Defaults to no cap. */
    maxDelayMs?: number;
    onRetry?: (details: {
        operation: string;
        attempt: number;
        maxAttempts: number;
        delayMs: number;
        error: unknown;
    }) => void;
}
/**
 * Runs a required startup check with a small, bounded retry budget.
 *
 * Only transport-level PostgreSQL failures are retried. Authentication, TLS,
 * configuration, and SQL failures remain fail-fast so a bad deployment is
 * never obscured as a transient outage.
 */
export declare function retryTransientStartupOperation<T>(operation: string, connect: () => Promise<T>, options?: StartupRetryOptions): Promise<T>;
/** Apply the single configured startup policy used by every PostgreSQL process. */
export declare function retryConfiguredStartupOperation<T>(operation: string, connect: () => Promise<T>, log: Pick<Logger, 'warn'>): Promise<T>;
//# sourceMappingURL=startup-retry.d.ts.map