/** Stable error code used when pg-boss expires or stops an ingest handler. */
export declare const INGESTION_JOB_ABORTED: "INGESTION_JOB_ABORTED";
/**
 * Cooperative cancellation error for accepted ingestion work.
 *
 * pg-boss v12 attaches one AbortSignal to every delivered job in a handler
 * batch and aborts it when the handler expires or its worker is stopped. Using
 * a distinct error code keeps that lifecycle event separate from PostgreSQL
 * statement/connection timeouts in metrics and retry diagnostics.
 */
export declare class IngestionJobAbortedError extends Error {
    readonly code: "INGESTION_JOB_ABORTED";
    readonly phase: string;
    constructor(phase: string, reason?: unknown);
}
/** Throw synchronously before starting another irreversible unit of work. */
export declare function throwIfIngestionAborted(signal: AbortSignal | undefined, phase: string): void;
export declare function isIngestionAbortError(err: unknown): err is IngestionJobAbortedError;
//# sourceMappingURL=ingestion-abort.d.ts.map