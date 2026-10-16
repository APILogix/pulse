import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool, PoolClient, QueryResult } from 'pg';
import {
  DB_QUERY_NAMES,
  isRegisteredQueryName,
  measuredQuery,
  withMeasuredTransaction,
  measuredIngestBatch,
  runWithPerfContext,
  getActivePerfContext,
  getParameterShape,
  SlowQueryRateLimiter,
  validateQueryBudgets,
  getQueryBudget,
  isBudgetBreached,
  dbQueryDurationHistogram,
  dbPoolWaitHistogram,
  cacheRequestsTotalCounter,
  cacheOpDurationHistogram,
  recordCacheRequest,
  recordCacheOp,
  ingestBatchRowsCounter,
  ingestBatchDurationHistogram,
} from '../../src/config/perf/index.js';

describe('Performance Measurement Subsystem', () => {
  let mockClient: PoolClient;
  let mockPool: Pool;

  beforeEach(() => {
    mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, _params?: any[]) => {
        return {
          rows: [{ id: 1, name: 'test' }],
          command: 'SELECT',
          rowCount: 1,
          oid: 0,
          fields: [],
        } as QueryResult<any>;
      }),
      release: vi.fn(),
    } as unknown as PoolClient;

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      totalCount: 5,
      idleCount: 3,
      waitingCount: 0,
    } as unknown as Pool;
  });

  describe('1. Stable Query Names Catalog & Budgets', () => {
    it('validates registered query names', () => {
      expect(isRegisteredQueryName('auth.apiKeyLookup')).toBe(true);
      expect(isRegisteredQueryName('traces.getById')).toBe(true);
      expect(isRegisteredQueryName('SELECT * FROM users')).toBe(false);
    });

    it('validates that every registered query has a defined latency budget', () => {
      expect(() => validateQueryBudgets()).not.toThrow();
      const budget = getQueryBudget(DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP);
      expect(budget).toBeDefined();
      expect(budget?.p95Ms).toBe(5);
      expect(budget?.p99Ms).toBe(15);
    });

    it('detects latency budget breaches', () => {
      expect(isBudgetBreached(DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP, 4)).toBe(false);
      expect(isBudgetBreached(DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP, 10)).toBe(true);
    });
  });

  describe('2. Measured Query Wrapper & Metric Fail-Safety', () => {
    it('measures execution duration and records success metrics', async () => {
      const observeSpy = vi.spyOn(dbQueryDurationHistogram, 'observe');

      const res = await measuredQuery(
        DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP,
        'SELECT * FROM api_keys WHERE id = $1',
        ['key_123'],
        { pool: mockPool, db: 'control' },
      );

      expect(res.rows).toEqual([{ id: 1, name: 'test' }]);
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM api_keys WHERE id = $1',
        ['key_123'],
      );
      expect(mockClient.release).toHaveBeenCalled();
      expect(observeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          db: 'control',
          query: DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP,
          status: 'ok',
        }),
        expect.any(Number),
      );
    });

    it('measures pool wait time separately when acquiring a connection', async () => {
      const waitObserveSpy = vi.spyOn(dbPoolWaitHistogram, 'observe');

      await measuredQuery(
        DB_QUERY_NAMES.ORG_GET_BY_ID,
        'SELECT * FROM organizations WHERE id = $1',
        ['org_1'],
        { pool: mockPool, db: 'control' },
      );

      expect(waitObserveSpy).toHaveBeenCalledWith(
        { db: 'control' },
        expect.any(Number),
      );
    });

    it('does not re-measure pool wait when client is already checked out', async () => {
      const waitObserveSpy = vi.spyOn(dbPoolWaitHistogram, 'observe');
      waitObserveSpy.mockClear();

      await measuredQuery(
        DB_QUERY_NAMES.ORG_GET_BY_ID,
        'SELECT 1',
        [],
        { client: mockClient, db: 'control' },
      );

      expect(mockPool.connect).not.toHaveBeenCalled();
      expect(waitObserveSpy).not.toHaveBeenCalled();
    });

    it('records error metric and propagates query errors safely', async () => {
      const observeSpy = vi.spyOn(dbQueryDurationHistogram, 'observe');
      (mockClient.query as any).mockRejectedValueOnce(new Error('Syntax error in SQL'));

      await expect(
        measuredQuery(
          DB_QUERY_NAMES.AUTH_USER_LOOKUP_BY_EMAIL,
          'SELECT bad sql',
          [],
          { pool: mockPool, db: 'control' },
        ),
      ).rejects.toThrow('Syntax error in SQL');

      expect(observeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          db: 'control',
          query: DB_QUERY_NAMES.AUTH_USER_LOOKUP_BY_EMAIL,
          status: 'error',
        }),
        expect.any(Number),
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('guarantees query success even if metrics observation throws (Fail-Safe)', async () => {
      const observeSpy = vi.spyOn(dbQueryDurationHistogram, 'observe');
      observeSpy.mockImplementationOnce(() => {
        throw new Error('Prometheus registry memory overflow');
      });

      const res = await measuredQuery(
        DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP,
        'SELECT 1',
        [],
        { pool: mockPool, db: 'control' },
      );

      expect(res.rowCount).toBe(1);
    });
  });

  describe('3. Measured Transactions', () => {
    it('wraps transaction, executes statements, and records total duration', async () => {
      const observeSpy = vi.spyOn(dbQueryDurationHistogram, 'observe');

      const result = await withMeasuredTransaction(
        DB_QUERY_NAMES.ORG_CREATE,
        async (tx) => {
          const r1 = await tx.query(
            DB_QUERY_NAMES.ORG_CREATE,
            'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
            ['Acme Corp'],
          );
          const r2 = await tx.query(
            DB_QUERY_NAMES.AUTH_CREATE_SESSION,
            'INSERT INTO audit_logs (action) VALUES ($1)',
            ['org_created'],
          );
          return { orgId: r1.rows[0].id, logCount: r2.rowCount };
        },
        { pool: mockPool, db: 'control' },
      );

      expect(result).toEqual({ orgId: 1, logCount: 1 });
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
      expect(observeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          db: 'control',
          query: DB_QUERY_NAMES.ORG_CREATE,
          status: 'ok',
        }),
        expect.any(Number),
      );
    });

    it('rolls back transaction on error and releases connection', async () => {
      (mockClient.query as any).mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return {};
        if (sql.includes('FAILING')) throw new Error('Unique constraint violation');
        if (sql === 'ROLLBACK') return {};
        return { rows: [] };
      });

      await expect(
        withMeasuredTransaction(
          DB_QUERY_NAMES.ORG_CREATE,
          async (tx) => {
            await tx.query(DB_QUERY_NAMES.ORG_CREATE, 'FAILING QUERY');
          },
          { pool: mockPool, db: 'control' },
        ),
      ).rejects.toThrow('Unique constraint violation');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('4. AsyncLocalStorage Context & N+1 Pattern Detection', () => {
    it('propagates request context and accumulates stats', async () => {
      await runWithPerfContext(
        { requestId: 'test-req-123', route: '/v1/org/:id', tier: 'pro' },
        async () => {
          const ctxBefore = getActivePerfContext();
          expect(ctxBefore?.requestId).toBe('test-req-123');
          expect(ctxBefore?.queryCount).toBe(0);

          await measuredQuery(DB_QUERY_NAMES.ORG_GET_BY_ID, 'SELECT 1', [], {
            client: mockClient,
          });
          await measuredQuery(DB_QUERY_NAMES.PROJECT_LIST_BY_ORG, 'SELECT 1', [], {
            client: mockClient,
          });

          const ctxAfter = getActivePerfContext();
          expect(ctxAfter?.queryCount).toBe(2);
          expect(ctxAfter?.totalDbTimeMs).toBeGreaterThanOrEqual(0);
          expect(ctxAfter?.queryFrequency.get(DB_QUERY_NAMES.ORG_GET_BY_ID)).toBe(1);
          expect(ctxAfter?.queryFrequency.get(DB_QUERY_NAMES.PROJECT_LIST_BY_ORG)).toBe(1);
        },
      );
    });

    it('detects N+1 query patterns when queries exceed threshold (default 20)', async () => {
      await runWithPerfContext(
        { requestId: 'test-n1', route: '/v1/n1-test' },
        async () => {
          for (let i = 0; i < 25; i++) {
            await measuredQuery(DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP, 'SELECT 1', [], {
              client: mockClient,
            });
          }

          const ctx = getActivePerfContext();
          expect(ctx?.queryCount).toBe(25);
          expect(ctx?.nPlusOneLogged).toBe(true);
          expect(ctx?.queryFrequency.get(DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP)).toBe(25);
        },
      );
    });
  });

  describe('5. PII-Safe Parameter Sanitizer & Slow Query Rate Limiting', () => {
    it('sanitizes parameters into shape signatures without values', () => {
      const params = [
        'sensitive_api_key_sk_live_1234567890',
        99.99,
        true,
        new Date('2026-01-01T00:00:00Z'),
        [1, 2, 3],
        { secret: 'verysecret', token: 'bearer-token' },
        Buffer.from('binary-content'),
        null,
      ];

      const shapes = getParameterShape(params);
      expect(shapes).toEqual([
        'string(len=36)',
        'number',
        'boolean',
        'date',
        'array(len=3)',
        'object(keys=2)',
        'buffer(14B)',
        'null',
      ]);

      const jsonStr = JSON.stringify(shapes);
      expect(jsonStr).not.toContain('sensitive');
      expect(jsonStr).not.toContain('verysecret');
      expect(jsonStr).not.toContain('bearer');
    });

    it('rate-limits slow query logging to avoid log storms', () => {
      const limiter = new SlowQueryRateLimiter(3, 60_000);

      expect(limiter.check('queryA').shouldLog).toBe(true);
      expect(limiter.check('queryA').shouldLog).toBe(true);
      expect(limiter.check('queryA').shouldLog).toBe(true);

      // 4th and 5th within 1 minute window should be suppressed
      const r4 = limiter.check('queryA');
      expect(r4.shouldLog).toBe(false);
      expect(r4.suppressedCount).toBe(1);

      const r5 = limiter.check('queryA');
      expect(r5.shouldLog).toBe(false);
      expect(r5.suppressedCount).toBe(2);

      // Different query has its own independent rate limit window
      expect(limiter.check('queryB').shouldLog).toBe(true);
    });
  });

  describe('6. Cache Metrics Instrumentation', () => {
    it('records L1 and Redis cache request hits and misses', () => {
      const incSpy = vi.spyOn(cacheRequestsTotalCounter, 'inc');

      recordCacheRequest('l1', 'api_key', 'hit');
      recordCacheRequest('redis', 'api_key', 'miss');

      expect(incSpy).toHaveBeenCalledWith({ layer: 'l1', cache: 'api_key', result: 'hit' });
      expect(incSpy).toHaveBeenCalledWith({ layer: 'redis', cache: 'api_key', result: 'miss' });
    });

    it('records cache operation duration', () => {
      const observeSpy = vi.spyOn(cacheOpDurationHistogram, 'observe');

      recordCacheOp('get', 'api_key', 2.5);
      expect(observeSpy).toHaveBeenCalledWith({ op: 'get', cache: 'api_key' }, 0.0025);
    });
  });

  describe('7. Ingestion Batch Performance Tracking', () => {
    it('records batch duration and total rows without per-row query metrics', async () => {
      const batchDurationSpy = vi.spyOn(ingestBatchDurationHistogram, 'observe');
      const batchRowsSpy = vi.spyOn(ingestBatchRowsCounter, 'inc');
      const singleQuerySpy = vi.spyOn(dbQueryDurationHistogram, 'observe');

      singleQuerySpy.mockClear();

      const result = await measuredIngestBatch('logs', 500, async () => {
        return { inserted: 500 };
      });

      expect(result).toEqual({ inserted: 500 });
      expect(batchDurationSpy).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'logs', status: 'ok' }),
        expect.any(Number),
      );
      expect(batchRowsSpy).toHaveBeenCalledWith({ source: 'logs' }, 500);

      // High-throughput ingest does NOT flood single query duration histogram
      expect(singleQuerySpy).not.toHaveBeenCalled();
    });
  });
});
