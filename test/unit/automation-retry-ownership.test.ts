/**
 * Retry-ownership tests.
 *
 * These pin down the fix for the double-retry defect: a single failed step used to
 * produce TWO independent resume attempts, because handleStepFailure enqueued a
 * delayed execute job (singletonKey `run:<id>:retry:<stepId>`) AND executeRun
 * rethrew so pg-boss retried the original job (singletonKey `run:<id>`). The two
 * keys could not dedupe against each other.
 *
 * The contract now is: the application owns step retries; pg-boss retry is only a
 * fallback for a failed enqueue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// pg-boss must be mocked before importing workers.ts, which imports it at module load.
const sendMock = vi.fn();
vi.mock('../../src/lib/pgboss.js', () => ({
  pgboss: {
    send: (...args: unknown[]) => sendMock(...args),
    work: vi.fn(),
    schedule: vi.fn(),
    unschedule: vi.fn(),
    createQueue: vi.fn(),
  },
}));

// The pool is imported at module load too; it must not open a real connection.
vi.mock('../../src/config/database.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

const { handleStepFailure } = await import('../../src/modules/automation/workers.js');

function makeLogger() {
  return {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    fatal: vi.fn(), trace: vi.fn(), silent: vi.fn(),
    child() { return makeLogger(); },
    level: 'info',
  } as never;
}

function makeRepo() {
  return { updateStepStatus: vi.fn().mockResolvedValue(undefined) } as never;
}

const STEP = {
  id: 'step-1',
  runId: 'run-1',
  attempt: 1,
  maxAttempts: 3,
  metadata: { retryBackoffSeconds: 30 },
};

describe('step retry ownership', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue('job-id');
  });

  it('schedules exactly ONE delayed execute job per retryable failure', async () => {
    const repo = makeRepo();
    const outcome = await handleStepFailure(
      STEP, 'STEP_ERROR', 'boom', {}, repo, makeLogger(), 'run-1', 'org-1',
    );

    expect(outcome).toEqual({ retryScheduled: true, retryEnqueued: true });
    // Exactly one enqueue — not one per mechanism.
    expect(sendMock).toHaveBeenCalledTimes(1);

    const [queue, payload, options] = sendMock.mock.calls[0]!;
    expect(queue).toBe('automation-run-execute');
    expect(payload).toEqual({ runId: 'run-1', orgId: 'org-1' });
    // The retry is deferred, and keyed per step so distinct steps don't collide.
    expect(options).toMatchObject({ singletonKey: 'run:run-1:retry:step-1' });
    expect(typeof (options as { startAfter: string }).startAfter).toBe('string');
  });

  it('puts the step back to queued with a future next_retry_at', async () => {
    const repo = makeRepo();
    const before = Date.now();
    await handleStepFailure(STEP, 'STEP_ERROR', 'boom', {}, repo, makeLogger(), 'run-1', 'org-1');

    const update = (repo as unknown as { updateStepStatus: ReturnType<typeof vi.fn> })
      .updateStepStatus.mock.calls[0]!;
    expect(update[0]).toBe('step-1');
    expect(update[1]).toMatchObject({ status: 'queued', errorCode: 'STEP_ERROR' });
    // Backoff for attempt 1 is retryBackoffSeconds * 2^0 = 30s.
    const nextRetryAt = (update[1] as { nextRetryAt: Date }).nextRetryAt.getTime();
    expect(nextRetryAt).toBeGreaterThanOrEqual(before + 30_000 - 1_000);
    expect(nextRetryAt).toBeLessThanOrEqual(before + 30_000 + 5_000);
  });

  it('applies exponential backoff across attempts, capped at one hour', async () => {
    const repo = makeRepo();
    const log = makeLogger();
    const delays: number[] = [];

    for (const attempt of [1, 2, 3]) {
      (repo as unknown as { updateStepStatus: ReturnType<typeof vi.fn> }).updateStepStatus.mockClear();
      const t0 = Date.now();
      await handleStepFailure(
        { ...STEP, attempt, maxAttempts: 10 }, 'STEP_ERROR', 'boom', {}, repo, log, 'run-1', 'org-1',
      );
      const call = (repo as unknown as { updateStepStatus: ReturnType<typeof vi.fn> })
        .updateStepStatus.mock.calls[0]!;
      delays.push((call[1] as { nextRetryAt: Date }).nextRetryAt.getTime() - t0);
    }

    // 30s, 60s, 120s (allowing scheduling slack)
    expect(delays[0]).toBeGreaterThan(25_000);
    expect(delays[0]).toBeLessThan(35_000);
    expect(delays[1]).toBeGreaterThan(55_000);
    expect(delays[1]).toBeLessThan(65_000);
    expect(delays[2]).toBeGreaterThan(115_000);
    expect(delays[2]).toBeLessThan(125_000);

    // Cap: a huge attempt number must not exceed 1 hour.
    (repo as unknown as { updateStepStatus: ReturnType<typeof vi.fn> }).updateStepStatus.mockClear();
    const t0 = Date.now();
    await handleStepFailure(
      { ...STEP, attempt: 30, maxAttempts: 99 }, 'STEP_ERROR', 'boom', {}, repo, log, 'run-1', 'org-1',
    );
    const capped = (repo as unknown as { updateStepStatus: ReturnType<typeof vi.fn> })
      .updateStepStatus.mock.calls[0]!;
    const cappedDelay = (capped[1] as { nextRetryAt: Date }).nextRetryAt.getTime() - t0;
    expect(cappedDelay).toBeLessThanOrEqual(3_600_000 + 5_000);
  });

  /**
   * The fallback case. If the app cannot enqueue, it reports retryEnqueued=false so
   * executeRun rethrows and pg-boss's own retry takes over. This is the ONLY
   * situation in which both mechanisms are allowed to be involved.
   */
  it('reports retryEnqueued=false when the delayed enqueue fails', async () => {
    sendMock.mockRejectedValue(new Error('queue unavailable'));
    const repo = makeRepo();
    const outcome = await handleStepFailure(
      STEP, 'STEP_ERROR', 'boom', {}, repo, makeLogger(), 'run-1', 'org-1',
    );
    expect(outcome).toEqual({ retryScheduled: true, retryEnqueued: false });
    // The step is still durably marked for retry, so the maintenance sweep can
    // recover it even if pg-boss also gives up.
    expect((repo as unknown as { updateStepStatus: ReturnType<typeof vi.fn> })
      .updateStepStatus).toHaveBeenCalledWith('step-1', expect.objectContaining({ status: 'queued' }));
  });

  it('marks the step failed and schedules nothing once attempts are exhausted', async () => {
    const repo = makeRepo();
    const outcome = await handleStepFailure(
      { ...STEP, attempt: 3, maxAttempts: 3 }, 'STEP_ERROR', 'boom', {}, repo, makeLogger(), 'run-1', 'org-1',
    );

    expect(outcome).toEqual({ retryScheduled: false, retryEnqueued: false });
    // No further retry may be scheduled for a terminal step.
    expect(sendMock).not.toHaveBeenCalled();
    expect((repo as unknown as { updateStepStatus: ReturnType<typeof vi.fn> })
      .updateStepStatus).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({ status: 'failed', completedAt: expect.any(Date) }),
    );
  });

  it('does not enqueue when runId/orgId are unavailable, but still marks for retry', async () => {
    const repo = makeRepo();
    const outcome = await handleStepFailure(
      { id: 'step-x', attempt: 1, maxAttempts: 3, metadata: {} },
      'STEP_ERROR', 'boom', {}, repo, makeLogger(),
      undefined, undefined,
    );
    expect(outcome).toEqual({ retryScheduled: true, retryEnqueued: false });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('executeRun rethrow policy (source contract)', () => {
  it('only rethrows when the application failed to take retry ownership', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/modules/automation/workers.ts'),
      'utf8',
    );
    // The unconditional rethrow is gone.
    expect(src).not.toContain("if (errorCode === 'STEP_ERROR' && step.attempt < step.maxAttempts) {");
    // Replaced by the ownership-conditional rethrow.
    expect(src).toContain('if (outcome.retryScheduled && !outcome.retryEnqueued) {');
  });
});
