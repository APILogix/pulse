/** Stable error code used when pg-boss expires or stops an ingest handler. */
export const INGESTION_JOB_ABORTED = 'INGESTION_JOB_ABORTED' as const;

/**
 * Cooperative cancellation error for accepted ingestion work.
 *
 * pg-boss v12 attaches one AbortSignal to every delivered job in a handler
 * batch and aborts it when the handler expires or its worker is stopped. Using
 * a distinct error code keeps that lifecycle event separate from PostgreSQL
 * statement/connection timeouts in metrics and retry diagnostics.
 */
export class IngestionJobAbortedError extends Error {
  readonly code = INGESTION_JOB_ABORTED;
  readonly phase: string;

  constructor(phase: string, reason?: unknown) {
    super(`ingestion job aborted during ${phase}`, reason === undefined ? undefined : { cause: reason });
    this.name = 'AbortError';
    this.phase = phase;
  }
}

/** Throw synchronously before starting another irreversible unit of work. */
export function throwIfIngestionAborted(
  signal: AbortSignal | undefined,
  phase: string,
): void {
  if (signal?.aborted) {
    throw new IngestionJobAbortedError(phase, signal.reason);
  }
}

export function isIngestionAbortError(err: unknown): err is IngestionJobAbortedError {
  return err instanceof IngestionJobAbortedError
    || (typeof err === 'object'
      && err !== null
      && (err as { code?: unknown }).code === INGESTION_JOB_ABORTED);
}
