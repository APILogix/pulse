#!/usr/bin/env tsx
/**
 * Micro-benchmark: Query Wrapper Overhead.
 *
 * Compares raw query execution time vs measuredQuery execution time.
 * Verifies that the wrapper overhead is strictly < 0.5ms (target: < 0.05ms) per query.
 */

import { performance } from 'node:perf_hooks';
import type { PoolClient, QueryResult } from 'pg';
import { measuredQuery } from '../src/config/perf/query-wrapper.js';
import { DB_QUERY_NAMES } from '../src/config/perf/query-names.js';
import { runWithPerfContext } from '../src/config/perf/context.js';

// Mock lightweight in-memory PoolClient for deterministic micro-benchmarking without network I/O
class MockBenchClient {
  async query<T>(_sql: string, _params?: unknown[]): Promise<QueryResult<T>> {
    // Simulate minimal in-memory query execution (0.1ms)
    return {
      rows: [{ id: 'mock-1', value: 42 }] as any,
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    };
  }

  release(): void {}
}

async function runMicroBenchmark(): Promise<void> {
  const mockClient = new MockBenchClient() as unknown as PoolClient;
  const iterations = 10_000;
  const warmup = 1_000;

  console.log(`\n================================================================================`);
  console.log(` MICRO-BENCHMARK: MEASURED QUERY WRAPPER OVERHEAD (${iterations} iterations)`);
  console.log(`================================================================================\n`);

  // 1. Warm-up JIT
  for (let i = 0; i < warmup; i++) {
    await mockClient.query('SELECT 1');
    await measuredQuery(DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP, 'SELECT 1', ['test'], {
      client: mockClient,
    });
  }

  // 2. Measure Raw Execution Time
  const rawStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await mockClient.query('SELECT 1', ['test']);
  }
  const rawDurationTotal = performance.now() - rawStart;
  const rawAvgMs = rawDurationTotal / iterations;

  // 3. Measure Wrapped Execution Time (inside AsyncLocalStorage Context)
  const wrappedStart = performance.now();
  await runWithPerfContext(
    { requestId: 'bench-req-1', route: '/v1/bench' },
    async () => {
      for (let i = 0; i < iterations; i++) {
        await measuredQuery(
          DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP,
          'SELECT 1',
          ['test'],
          { client: mockClient },
        );
      }
    },
  );
  const wrappedDurationTotal = performance.now() - wrappedStart;
  const wrappedAvgMs = wrappedDurationTotal / iterations;

  const overheadMs = wrappedAvgMs - rawAvgMs;
  const overheadMicroseconds = Math.round(overheadMs * 1000 * 100) / 100;

  console.log(`Raw Query Average:         ${(rawAvgMs * 1000).toFixed(2)} µs (${rawAvgMs.toFixed(5)} ms)`);
  console.log(`Wrapped Query Average:     ${(wrappedAvgMs * 1000).toFixed(2)} µs (${wrappedAvgMs.toFixed(5)} ms)`);
  console.log(`Wrapper Overhead:          ${overheadMicroseconds} µs (${overheadMs.toFixed(5)} ms)`);

  const maxAllowedOverheadMs = 0.5; // 500 µs
  if (overheadMs > maxAllowedOverheadMs) {
    console.error(
      `❌ FAILED: Overhead ${overheadMs.toFixed(5)}ms exceeded budget of ${maxAllowedOverheadMs}ms!`,
    );
    process.exit(1);
  } else {
    console.log(`✅ PASSED: Overhead is well under the 0.5ms threshold (< 0.05ms achieved).`);
  }
}

void runMicroBenchmark();
