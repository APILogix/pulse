import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { AlertRuntimeRepository } from '../../src/modules/alerting/runtime/alert-runtime.repository.js';

describe('Alert Priority & Claim Ordering (Phases 2 & 3)', () => {
  it('orders claimed notification jobs by priority DESC, created_at ASC with SKIP LOCKED', async () => {
    let capturedSql = '';
    let capturedParams: any[] = [];

    const mockPool = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        capturedSql = sql;
        capturedParams = params;
        return {
          rows: [
            {
              id: 'job-p0',
              priority: 2, // P0 / High
              status: 'queued',
            },
            {
              id: 'job-p2',
              priority: 0, // P2 / Low
              status: 'queued',
            },
          ],
          rowCount: 2,
        };
      }),
    } as unknown as Pool;

    const repository = new AlertRuntimeRepository(mockPool);
    const claimed = await repository.claimDueNotificationJobs(50);

    expect(claimed).toHaveLength(2);
    expect(claimed[0].id).toBe('job-p0');
    expect(claimed[0].priority).toBe(2);

    // Verify SQL query contains priority ordering and SKIP LOCKED concurrency protection
    expect(capturedSql).toContain('ORDER BY priority DESC, created_at ASC');
    expect(capturedSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(capturedSql).toContain("status = 'pending'");
    expect(capturedParams).toEqual([50]);
  });

  it('bounds the query limit between 1 and 1000', async () => {
    let capturedParams: any[] = [];

    const mockPool = {
      query: vi.fn().mockImplementation(async (_sql: string, params: any[]) => {
        capturedParams = params;
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as Pool;

    const repository = new AlertRuntimeRepository(mockPool);

    await repository.claimDueNotificationJobs(0);
    expect(capturedParams).toEqual([1]);

    await repository.claimDueNotificationJobs(5000);
    expect(capturedParams).toEqual([1000]);
  });
});
