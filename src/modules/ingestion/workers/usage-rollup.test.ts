import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

const mocks = vi.hoisted(() => ({
  work: vi.fn(),
  schedule: vi.fn(),
  unschedule: vi.fn(),
  offWork: vi.fn(),
}));

vi.mock('../../../config/env.js', () => ({
  env: {
    INGESTION_USAGE_ROLLUP_CRON: '*/5 * * * *',
  },
}));

vi.mock('../../../lib/pgboss.js', () => ({
  pgboss: {
    work: mocks.work,
    schedule: mocks.schedule,
    unschedule: mocks.unschedule,
    offWork: mocks.offWork,
  },
}));

function pool(): Pool {
  return {
    query: vi.fn(),
    connect: vi.fn(),
  } as unknown as Pool;
}

function logger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('UsageRollup lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.work.mockResolvedValue(undefined);
    mocks.schedule.mockResolvedValue(undefined);
    mocks.unschedule.mockResolvedValue(undefined);
    mocks.offWork.mockResolvedValue(undefined);
  });

  it('cleans up only the local worker before retrying and preserves the shared schedule', async () => {
    const { UsageRollup } = await import('./usage-rollup.js');
    const scheduleError = new Error('schedule registration failed');
    const initialCleanupError = new Error('initial offWork failed');
    const retryCleanupError = new Error('retry offWork failed');
    mocks.schedule.mockRejectedValueOnce(scheduleError);
    mocks.offWork
      .mockRejectedValueOnce(initialCleanupError)
      .mockRejectedValueOnce(retryCleanupError);

    const rollup = new UsageRollup(pool(), {} as never, logger() as never);

    await expect(rollup.start()).rejects.toBe(scheduleError);
    expect(mocks.unschedule).not.toHaveBeenCalled();
    expect(mocks.offWork).toHaveBeenCalledTimes(1);
    expect(mocks.work).toHaveBeenCalledTimes(1);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);

    await expect(rollup.start()).rejects.toBe(retryCleanupError);
    expect(mocks.offWork).toHaveBeenCalledTimes(2);
    expect(mocks.work).toHaveBeenCalledTimes(1);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);

    await expect(rollup.start()).resolves.toBeUndefined();
    expect(mocks.offWork).toHaveBeenCalledTimes(3);
    expect(mocks.work).toHaveBeenCalledTimes(2);
    expect(mocks.schedule).toHaveBeenCalledTimes(2);
    expect(mocks.offWork.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.work.mock.invocationCallOrder[1] as number,
    );

    await rollup.stop();
    expect(mocks.unschedule).not.toHaveBeenCalled();
    expect(mocks.offWork).toHaveBeenCalledTimes(4);
  });
});
