export interface OperationResult {
    durationMs: number;
    result: string;
}
export interface HeavyBenchmarkResults {
    hashing: OperationResult;
    sorting: OperationResult;
    fibonacci: OperationResult;
    totalMs: number;
}
export interface AsyncBenchmarkTask {
    name: string;
    durationMs: number;
}
export interface BenchmarkInfo {
    success: boolean;
    timestamp: string;
    pid: number;
    uptimeSeconds: number;
}
/**
 * Run N iterations of SHA-256 chaining.
 * Simulates cryptographic workload (API key hashing, token signing, etc.).
 */
export declare function runHashing(iterations: number): OperationResult;
/**
 * Allocate an array of `size` random floats and sort it.
 * Simulates in-memory sort workloads (analytics aggregation, rank queries).
 */
export declare function runSorting(size: number): OperationResult;
/**
 * Iterative Fibonacci — avoids call-stack overflow for large N.
 * Simulates tight arithmetic loops (compression, encoding, transforms).
 */
export declare function runFibonacci(n: number): OperationResult;
/**
 * Simulate a real async I/O task with a known delay.
 * Wraps a setTimeout so we exercise the event loop scheduler.
 */
export declare function simulateAsyncTask(name: string, delayMs: number): Promise<AsyncBenchmarkTask>;
/**
 * Light in-process async work — JSON serialisation + parse round-trip.
 * Mimics real payload processing in an ingestion pipeline.
 */
export declare function simulateJsonProcessing(records: number): Promise<AsyncBenchmarkTask>;
//# sourceMappingURL=helpers.d.ts.map