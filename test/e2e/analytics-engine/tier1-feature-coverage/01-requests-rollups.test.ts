import { describe, expect, it } from 'vitest';
import { createRequestsWorker } from '../../../src/modules/analytics-engine/workers/requests.worker.js';
import { AnalyticsWatermarkRepository } from '../../../src/modules/analytics-engine/watermark.repository.js';
import {
  createMockPool,
  createMockWorkerContext,
  createJobData,
  TEST_ORG,
} from '../helpers/test-harness.js';
import { ALL_ENVIRONMENTS_SENTINEL, ALL_PROJECTS_SENTINEL } from '../../../src/modules/analytics-engine/types.js';

describe('Tier 1: Feature 1 — events_requests Rollups (requests.worker)', () => {
  it('defines spec conforming to 1m live tier with single table ownership', () => {
    const { pool } = createMockPool();
    const watermarks = new AnalyticsWatermarkRepository(pool);
    const worker = createRequestsWorker(watermarks);

    expect(worker.id).toBe('analytics.requests');
    expect(worker.queue).toBe('analytics.requests');
    expect(worker.tier).toBe('live');
    expect(worker.windowSize).toBe('1m');
    expect(worker.sourceTables).toEqual(['events_requests']);
    expect(worker.outputTables).toEqual(['request_metrics_1m']);
    expect(worker.concurrency).toBeGreaterThanOrEqual(1);
    expect(worker.retryLimit).toBeGreaterThan(0);
  });

  it('generates recompute SQL with correct status code classification columns', async () => {
    const { pool, mockDb } = createMockPool();
    const watermarks = new AnalyticsWatermarkRepository(pool);
    const worker = createRequestsWorker(watermarks);
    const ctx = createMockWorkerContext(pool, { apdexThresholdMs: 250 });

    mockDb.addHandler((sql) => {
      if (sql.includes('COUNT(*) AS count FROM events_requests')) {
        return { rows: [{ count: '10' }], command: 'SELECT', rowCount: 1, oid: 0, fields: [] };
      }
      if (sql.includes('INSERT INTO request_metrics_1m')) {
        return { rows: [], command: 'INSERT', rowCount: 5, oid: 0, fields: [] };
      }
      return undefined;
    });

    const job = createJobData();
    const result = await worker.run(ctx, job);

    expect(result.outcome).toBe('success');
    expect(result.rowsRead).toBe(10);
    expect(result.rowsWritten).toBe(5);

    const insertQuery = mockDb.clientQueries.find((q) => q.sql.includes('INSERT INTO request_metrics_1m'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.sql).toContain('events_requests');
    expect(insertQuery!.sql).toContain('success_count');
    expect(insertQuery!.sql).toContain('client_error_count');
    expect(insertQuery!.sql).toContain('error_count');
    expect(insertQuery!.sql).toContain('auth_failure_count');
    expect(insertQuery!.sql).toContain('rate_limited_count');
  });

  it('computes Apdex satisfied and tolerating thresholds based on engine config', async () => {
    const { pool, mockDb } = createMockPool();
    const watermarks = new AnalyticsWatermarkRepository(pool);
    const worker = createRequestsWorker(watermarks);
    const apdexThreshold = 400;
    const toleratingThreshold = apdexThreshold * 4; // 1600
    const ctx = createMockWorkerContext(pool, { apdexThresholdMs: apdexThreshold });

    mockDb.addHandler((sql) => {
      if (sql.includes('COUNT(*) AS count FROM events_requests')) {
        return { rows: [{ count: '1' }], command: 'SELECT', rowCount: 1, oid: 0, fields: [] };
      }
      return undefined;
    });

    await worker.run(ctx, createJobData());

    const insertQuery = mockDb.clientQueries.find((q) => q.sql.includes('INSERT INTO request_metrics_1m'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.sql).toContain(`e.duration_ms <= ${apdexThreshold}`);
    expect(insertQuery!.sql).toContain(`e.duration_ms > ${apdexThreshold} AND e.duration_ms <= ${toleratingThreshold}`);
  });

  it('includes grouping sets for organization and environment sentinels', async () => {
    const { pool, mockDb } = createMockPool();
    const watermarks = new AnalyticsWatermarkRepository(pool);
    const worker = createRequestsWorker(watermarks);
    const ctx = createMockWorkerContext(pool);

    mockDb.addHandler((sql) => {
      if (sql.includes('COUNT(*) AS count FROM events_requests')) {
        return { rows: [{ count: '1' }], command: 'SELECT', rowCount: 1, oid: 0, fields: [] };
      }
      return undefined;
    });

    await worker.run(ctx, createJobData());

    const insertQuery = mockDb.clientQueries.find((q) => q.sql.includes('INSERT INTO request_metrics_1m'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.sql).toContain('GROUPING SETS');
    expect(insertQuery!.sql).toContain(ALL_PROJECTS_SENTINEL);
    expect(insertQuery!.sql).toContain(ALL_ENVIRONMENTS_SENTINEL);
  });

  it('applies two sketch passes for unique_users_hll and unique_sessions_hll', async () => {
    const { pool, mockDb } = createMockPool();
    const watermarks = new AnalyticsWatermarkRepository(pool);
    const worker = createRequestsWorker(watermarks);
    const ctx = createMockWorkerContext(pool);

    mockDb.addHandler((sql) => {
      if (sql.includes('COUNT(*) AS count FROM events_requests')) {
        return { rows: [{ count: '1' }], command: 'SELECT', rowCount: 1, oid: 0, fields: [] };
      }
      return undefined;
    });

    await worker.run(ctx, createJobData());

    // Check sketch queries executed during afterWrite
    const sketchQueries = mockDb.clientQueries.filter((q) => q.sql.includes('unique_users_hll') || q.sql.includes('unique_sessions_hll'));
    expect(sketchQueries.length).toBeGreaterThanOrEqual(2);
  });

  it('skips processing and advances watermark cleanly when slice has zero rows', async () => {
    const { pool, mockDb } = createMockPool();
    const watermarks = new AnalyticsWatermarkRepository(pool);
    const worker = createRequestsWorker(watermarks);
    const ctx = createMockWorkerContext(pool);

    mockDb.addHandler((sql) => {
      if (sql.includes('COUNT(*) AS count FROM events_requests')) {
        return { rows: [{ count: '0' }], command: 'SELECT', rowCount: 1, oid: 0, fields: [] };
      }
      return undefined;
    });

    const result = await worker.run(ctx, createJobData());
    expect(result.outcome).toBe('skipped');
    expect(result.rowsRead).toBe(0);
    expect(result.rowsWritten).toBe(0);
  });
});
