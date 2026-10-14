import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import { UsageRollup } from '../../src/modules/ingestion/workers/usage-rollup.js';

describe('UsageRollup worker batching (ROLL-Q018)', () => {
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  const mockMetrics = {
    recordRollupSuccess: vi.fn(),
    recordRollupFailure: vi.fn(),
  };

  beforeEach(() => {
    // Reset static partition cache between runs if needed
    (UsageRollup as any).ensuredPartitions.clear();
  });

  it('batches entitlement updates and daily upserts into single set-based UNNEST queries', async () => {
    const executedQueries: Array<{ text: string; values: unknown[] }> = [];

    const mockClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        executedQueries.push({ text: sql, values: params ?? [] });
        if (sql.includes('DELETE FROM usage_counter_staging')) {
          return {
            rowCount: 3,
            rows: [
              {
                org_id: '11111111-1111-1111-1111-111111111111',
                project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                counter_type: 'billing:requests',
                increment_by: '10',
              },
              {
                org_id: '11111111-1111-1111-1111-111111111111',
                project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                counter_type: 'billing:errors',
                increment_by: '2',
              },
              {
                org_id: '22222222-2222-2222-2222-222222222222',
                project_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                counter_type: 'billing:logs',
                increment_by: '5',
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    } as unknown as PoolClient;

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;

    const rollup = new UsageRollup(mockPool, mockMetrics as any, mockLogger);
    await rollup.run();

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

    // Verify BULK entitlement update query
    const entitlementQuery = executedQueries.find((q) =>
      q.text.includes('UPDATE organization_usage_current_period'),
    );
    expect(entitlementQuery).toBeDefined();
    expect(entitlementQuery!.text).toContain('FROM (');
    expect(entitlementQuery!.text).toContain('SELECT UNNEST($1::uuid[]) AS org_id');
    expect(entitlementQuery!.values.length).toBe(3);
    // Org IDs
    expect(entitlementQuery!.values[0]).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    // Deltas: 12 for org1 (10 requests + 2 errors), 5 for org2 (5 logs)
    expect(entitlementQuery!.values[1]).toEqual([12, 5]);
    // Raw deltas: 12 for org1, 5 for org2
    expect(entitlementQuery!.values[2]).toEqual([12, 5]);

    // Verify BULK daily upsert query
    const dailyUpsertQuery = executedQueries.find((q) =>
      q.text.includes('INSERT INTO usage_daily_counters'),
    );
    expect(dailyUpsertQuery).toBeDefined();
    expect(dailyUpsertQuery!.text).toContain('FROM UNNEST(');
    expect(dailyUpsertQuery!.values.length).toBe(11);

    // Verify that NO sequential individual increment_event_usage calls occurred
    const singleCalls = executedQueries.filter((q) =>
      q.text.includes('SELECT increment_event_usage'),
    );
    expect(singleCalls.length).toBe(0);

    expect(mockMetrics.recordRollupSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        stagingRows: 3,
        events: 17,
        orgs: 2,
        projects: 2,
      }),
    );
  });
});
