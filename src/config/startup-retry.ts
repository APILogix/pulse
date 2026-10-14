import type { Logger } from 'pino';
import { env } from './env.js';
import { isTransientPostgresError } from './postgres-ssl.js';

export interface StartupRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Upper bound for a single backoff delay. Defaults to no cap. */
  maxDelayMs?: number;
  onRetry?: (details: { operation: string; attempt: number; maxAttempts: number; delayMs: number; error: unknown }) => void;
}

/**
 * Runs a required startup check with a small, bounded retry budget.
 *
 * Only transport-level PostgreSQL failures are retried. Authentication, TLS,
 * configuration, and SQL failures remain fail-fast so a bad deployment is
 * never obscured as a transient outage.
 */
export async function retryTransientStartupOperation<T>(
  operation: string,
  connect: () => Promise<T>,
  options: StartupRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? Number.POSITIVE_INFINITY;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientPostgresError(error)) {
        throw error;
      }

      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      options.onRetry?.({ operation, attempt, maxAttempts, delayMs, error });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(`Startup connection retry exhausted for ${operation}`);
}

/** Apply the single configured startup policy used by every PostgreSQL process. */
export function retryConfiguredStartupOperation<T>(
  operation: string,
  connect: () => Promise<T>,
  log: Pick<Logger, 'warn'>,
): Promise<T> {
  return retryTransientStartupOperation(operation, connect, {
    maxAttempts: env.STARTUP_DB_RETRY_MAX_ATTEMPTS,
    baseDelayMs: env.STARTUP_DB_RETRY_BASE_DELAY_MS,
    maxDelayMs: env.STARTUP_DB_RETRY_MAX_DELAY_MS,
    onRetry: ({ attempt, maxAttempts, delayMs, error }) => {
      log.warn(
        { err: error, operation, attempt, maxAttempts, delayMs },
        'Transient database startup connection failure; retrying',
      );
    },
  });
}
