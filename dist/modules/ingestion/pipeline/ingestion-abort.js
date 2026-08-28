/** Stable error code used when pg-boss expires or stops an ingest handler. */
export const INGESTION_JOB_ABORTED = 'INGESTION_JOB_ABORTED';
/**
 * Cooperative cancellation error for accepted ingestion work.
 *
 * pg-boss v12 attaches one AbortSignal to every delivered job in a handler
 * batch and aborts it when the handler expires or its worker is stopped. Using
 * a distinct error code keeps that lifecycle event separate from PostgreSQL
 * statement/connection timeouts in metrics and retry diagnostics.
 */
export class IngestionJobAbortedError extends Error {
    code = INGESTION_JOB_ABORTED;
    phase;
    constructor(phase, reason) {
        super(`ingestion job aborted during ${phase}`, reason === undefined ? undefined : { cause: reason });
        this.name = 'AbortError';
        this.phase = phase;
    }
}
/** Throw synchronously before starting another irreversible unit of work. */
export function throwIfIngestionAborted(signal, phase) {
    if (signal?.aborted) {
        throw new IngestionJobAbortedError(phase, signal.reason);
    }
}
export function isIngestionAbortError(err) {
    return err instanceof IngestionJobAbortedError
        || (typeof err === 'object'
            && err !== null
            && err.code === INGESTION_JOB_ABORTED);
}
//# sourceMappingURL=ingestion-abort.js.map