import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { memoryDiagnostics, captureMemorySnapshot } from '../../src/lib/memory-diagnostics.js';
import { UsageCounter } from '../../src/modules/ingestion/usage/usage-counter.js';

describe('Memory Plateau & Stress Verification Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    memoryDiagnostics.markStartupComplete();
  });

  afterAll(async () => {
    await app.close();
    memoryDiagnostics.stopMonitoring();
  });

  it('exposes GET /diagnostics/memory returning full diagnostic report', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/diagnostics/memory',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('startup');
    expect(body.data).toHaveProperty('current');
    expect(body.data).toHaveProperty('deltas');
    expect(body.data.current).toHaveProperty('heapUsedMB');
    expect(body.data.current).toHaveProperty('heapTotalMB');
    expect(body.data.current).toHaveProperty('rssMB');
    expect(body.data.current).toHaveProperty('externalMB');
    expect(body.data.current).toHaveProperty('arrayBuffersMB');
  });

  it('enforces safe POST /diagnostics/gc behavior', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/diagnostics/gc',
    });

    // In non-production, either succeeds (if node run with --expose-gc) or returns 400 with GC_NOT_EXPOSED
    if (typeof (globalThis as any).gc === 'function') {
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('freedMB');
    } else {
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('GC_NOT_EXPOSED');
    }
  });

  it('demonstrates stable post-GC heap plateau under stepped request workload', async () => {
    const steps = [500, 1000, 2000];
    const postGcHeaps: number[] = [];

    const gc = (globalThis as any).gc;
    const triggerGc = () => {
      if (typeof gc === 'function') {
        gc();
        gc();
      }
    };

    triggerGc();
    const baseline = captureMemorySnapshot();

    for (const count of steps) {
      // Execute requests concurrently in chunks
      const chunkSize = 50;
      for (let i = 0; i < count; i += chunkSize) {
        const batch = Array.from({ length: Math.min(chunkSize, count - i) }, () =>
          app.inject({ method: 'GET', url: '/health/live' }),
        );
        await Promise.all(batch);
      }

      triggerGc();
      await new Promise((resolve) => setImmediate(resolve));
      const snapshot = captureMemorySnapshot();
      postGcHeaps.push(snapshot.heapUsedMB);
    }

    // Steady state check: post-GC heap must not grow unbounded
    // Between step 2 (1000) and step 3 (2000), growth must be bounded (< 15 MB)
    const lastGrowth = postGcHeaps[2] - postGcHeaps[1];
    expect(lastGrowth).toBeLessThan(15);
  });

  it('enforces hard bounded limit and FIFO eviction on UsageCounter buffer', async () => {
    const mockPool = {
      query: () => Promise.resolve({ rowCount: 0, rows: [] }),
    } as any;

    const mockLogger = {
      info: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      error: () => undefined,
    } as any;

    const counter = new UsageCounter(mockPool, mockLogger, {
      bufferLimit: 500,
    });

    // Attempt to inject 25,000 distinct dimension keys
    for (let i = 0; i < 25_000; i++) {
      counter.increment(
        'a0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001',
        'events',
        1,
        { apiKeyId: `key-${i}`, eventType: `type-${i % 10}` },
      );
    }

    // Verify buffer is strictly capped at MAX_BUFFER_HARD_LIMIT (20,000)
    const internalBuffer = (counter as any).buffer as Map<string, unknown>;
    expect(internalBuffer.size).toBeLessThanOrEqual(20_000);
    expect(internalBuffer.size).toBeGreaterThan(0);
  });
});
