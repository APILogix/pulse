import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

vi.mock('../../../config/env.js', () => ({
  env: {
    INGESTION_USAGE_ROLLUP_CRON: '*/5 * * * *',
  },
}));

function pool(): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  } as unknown as Pool;
}

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

describe('UsageRollup lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts and stops cleanly with interval timer', async () => {
    const { UsageRollup } = await import('./usage-rollup.js');
    const rollup = new UsageRollup(pool(), { recordRollupSuccess: vi.fn(), recordRollupFailure: vi.fn() } as never, logger() as never);

    await rollup.start();
    await rollup.stop();
  });

  it('runs rollup batch and records metrics', async () => {
    const { UsageRollup } = await import('./usage-rollup.js');
    const metrics = { recordRollupSuccess: vi.fn(), recordRollupFailure: vi.fn() };
    const p = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes('DELETE FROM usage_counter_staging')) {
            return Promise.resolve({
              rowCount: 1,
              rows: [{ org_id: 'org-1', project_id: 'proj-1', counter_type: 'billing:request', increment_by: '5' }],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      }),
    } as unknown as Pool;
    const rollup = new UsageRollup(p, metrics as never, logger() as never);

    await rollup.run();
    expect(metrics.recordRollupSuccess).toHaveBeenCalled();
  });
});
