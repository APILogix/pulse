import type { Pool, PoolClient, QueryResult } from 'pg';
import { vi } from 'vitest';
import type {
  AnalyticsEngineConfig,
  AnalyticsJobData,
  AnalyticsQueryScope,
  WindowSize,
  WorkerContext,
} from '../../../src/modules/analytics-engine/types.js';
import { ALL_ENVIRONMENTS_SENTINEL, ALL_PROJECTS_SENTINEL } from '../../../src/modules/analytics-engine/types.js';
import { createSketch, addToSketch, toBuffer } from '../../../src/modules/analytics-engine/hll.js';
import { fromValues } from '../../../src/modules/analytics-engine/histogram.js';

export const TEST_ORG = '11111111-1111-4111-8111-111111111111';
export const TEST_PROJECT = '22222222-2222-4222-8222-222222222222';
export const TEST_PROJECT_2 = '33333333-3333-4333-8333-333333333333';
export const TEST_ENV = 'production';

export const DEFAULT_CONFIG: AnalyticsEngineConfig = {
  batchMaxRows: 10_000,
  maxWindowSpanMinutes: 60,
  lateEventGraceSeconds: 900,
  statementTimeoutMs: 30_000,
  entityTopK: 100,
  apdexThresholdMs: 300,
  sessionIdleMinutes: 30,
  freshnessStaleSeconds: 300,
  retentionEnabled: true,
};

export interface RecordedQuery {
  sql: string;
  params: unknown[];
  timestamp: Date;
}

export type QueryHandler = (sql: string, params?: unknown[]) => QueryResult<unknown> | Promise<QueryResult<unknown>> | undefined;

export class MockDbPool {
  public queries: RecordedQuery[] = [];
  private handlers: QueryHandler[] = [];
  public clientQueries: RecordedQuery[] = [];

  constructor() {
    this.query = this.query.bind(this);
    this.connect = this.connect.bind(this);
  }

  addHandler(handler: QueryHandler): void {
    this.handlers.push(handler);
  }

  clearQueries(): void {
    this.queries = [];
    this.clientQueries = [];
  }

  async query<T = unknown>(sqlOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]): Promise<QueryResult<T>> {
    const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
    const params = (typeof sqlOrConfig === 'string' ? values : sqlOrConfig.values) ?? [];
    this.queries.push({ sql, params, timestamp: new Date() });

    for (const handler of this.handlers) {
      const res = await handler(sql, params);
      if (res !== undefined) return res as QueryResult<T>;
    }

    // Default handlers for common queries
    if (sql.includes('SELECT current_database()')) {
      return {
        rows: [{ current_database: 'logdb_test', has_events: true, has_rollups: true }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      } as QueryResult<T>;
    }

    if (sql.includes('information_schema.columns')) {
      return {
        rows: [
          { column_name: 'organization_id', data_type: 'uuid' },
          { column_name: 'project_id', data_type: 'uuid' },
          { column_name: 'environment', data_type: 'text' },
          { column_name: 'bucket', data_type: 'timestamp with time zone' },
          { column_name: 'total_count', data_type: 'bigint' },
          { column_name: 'error_count', data_type: 'bigint' },
          { column_name: 'latency_sum_ms', data_type: 'numeric' },
          { column_name: 'latency_max_ms', data_type: 'numeric' },
          { column_name: 'latency_hist', data_type: 'ARRAY' },
          { column_name: 'unique_users_hll', data_type: 'bytea' },
          { column_name: 'unique_users_exact', data_type: 'bigint' },
        ],
        command: 'SELECT',
        rowCount: 11,
        oid: 0,
        fields: [],
      } as QueryResult<T>;
    }

    return {
      rows: [],
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
    } as QueryResult<T>;
  }

  async connect(): Promise<PoolClient> {
    const self = this;
    const client: PoolClient = {
      query: vi.fn().mockImplementation(async (sqlOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
        const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
        const params = (typeof sqlOrConfig === 'string' ? values : sqlOrConfig.values) ?? [];
        self.clientQueries.push({ sql, params, timestamp: new Date() });
        return self.query(sql, params);
      }),
      release: vi.fn(),
    } as unknown as PoolClient;
    return client;
  }
}

export function createMockPool(): { pool: Pool; mockDb: MockDbPool } {
  const mockDb = new MockDbPool();
  return { pool: mockDb as unknown as Pool, mockDb };
}

export function createMockWorkerContext(pool: Pool, config: Partial<AnalyticsEngineConfig> = {}): WorkerContext {
  return {
    pool,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any),
    } as any,
    now: new Date('2026-08-24T12:00:00Z'),
    config: { ...DEFAULT_CONFIG, ...config },
  };
}

export function createJobData(overrides: Partial<AnalyticsJobData> = {}): AnalyticsJobData {
  return {
    orgId: TEST_ORG,
    windowStart: '2026-08-24T11:00:00Z',
    windowEnd: '2026-08-24T12:00:00Z',
    recomputeFrom: '2026-08-24T10:45:00Z',
    ...overrides,
  };
}

export function createQueryScope(overrides: Partial<AnalyticsQueryScope> = {}): AnalyticsQueryScope {
  return {
    organizationId: TEST_ORG,
    projectId: TEST_PROJECT,
    environment: TEST_ENV,
    range: {
      from: new Date('2026-08-24T11:00:00Z'),
      to: new Date('2026-08-24T12:00:00Z'),
    },
    compareRange: {
      from: new Date('2026-08-24T10:00:00Z'),
      to: new Date('2026-08-24T11:00:00Z'),
    },
    window: '1m',
    limit: 50,
    ...overrides,
  };
}

export function buildSampleSketch(values: string[]): Uint8Array {
  const sketch = createSketch();
  for (const v of values) {
    addToSketch(sketch, v);
  }
  return toBuffer(sketch);
}

export function buildSampleHistogram(values: number[]): number[] {
  return fromValues(values);
}

export async function measureQueryExecution<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}
