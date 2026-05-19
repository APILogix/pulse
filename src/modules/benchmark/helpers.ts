/**
 * Benchmark helper functions.
 *
 * All functions are reusable, self-contained, and typed so the
 * benchmark routes stay readable and the helpers can be unit-tested
 * independently.
 */
import { createHash } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Run N iterations of SHA-256 chaining.
 * Simulates cryptographic workload (API key hashing, token signing, etc.).
 */
export function runHashing(iterations: number): OperationResult {
  const start = performance.now();
  let hash = 'benchmark-seed';
  for (let i = 0; i < iterations; i++) {
    hash = createHash('sha256').update(`${hash}:${i}`).digest('hex');
  }
  return {
    durationMs: Math.round(performance.now() - start),
    result: `${iterations} iterations → ${hash.slice(0, 16)}…`,
  };
}

/**
 * Allocate an array of `size` random floats and sort it.
 * Simulates in-memory sort workloads (analytics aggregation, rank queries).
 */
export function runSorting(size: number): OperationResult {
  const start = performance.now();
  const arr = Float64Array.from({ length: size }, () => Math.random() * 1_000_000);
  arr.sort();
  return {
    durationMs: Math.round(performance.now() - start),
    result: `sorted ${size.toLocaleString()} elements, first=${arr[0]?.toFixed(4)}`,
  };
}

/**
 * Iterative Fibonacci — avoids call-stack overflow for large N.
 * Simulates tight arithmetic loops (compression, encoding, transforms).
 */
export function runFibonacci(n: number): OperationResult {
  const start = performance.now();
  let a = 0n, b = 1n;
  for (let i = 2; i <= n; i++) {
    const tmp = a + b;
    a = b;
    b = tmp;
  }
  const digits = b.toString().length;
  return {
    durationMs: Math.round(performance.now() - start),
    result: `fib(${n}) has ${digits} digits`,
  };
}

/**
 * Simulate a real async I/O task with a known delay.
 * Wraps a setTimeout so we exercise the event loop scheduler.
 */
export function simulateAsyncTask(name: string, delayMs: number): Promise<AsyncBenchmarkTask> {
  return new Promise((resolve) => {
    const start = performance.now();
    setTimeout(() => {
      resolve({
        name,
        durationMs: Math.round(performance.now() - start),
      });
    }, delayMs);
  });
}

/**
 * Light in-process async work — JSON serialisation + parse round-trip.
 * Mimics real payload processing in an ingestion pipeline.
 */
export function simulateJsonProcessing(records: number): Promise<AsyncBenchmarkTask> {
  return new Promise((resolve) => {
    const start = performance.now();
    const data = Array.from({ length: records }, (_, i) => ({
      id: i,
      value: Math.random(),
      label: `item-${i}`,
    }));
    // round-trip: stringify → parse
    JSON.parse(JSON.stringify(data));
    resolve({
      name: 'json-processing',
      durationMs: Math.round(performance.now() - start),
    });
  });
}
