import { describe, expect, it, vi } from 'vitest';
import { PgQueueWorker, type JobHandler } from './pg-queue-worker.js';
import type { ClaimedJob, PgQueue } from './pg-queue.js';

function logger() {
  return {
    child: vi.fn().mockReturnThis(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

function queue() {
  return {
    claim: vi.fn(),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue('retried'),
    recoverStuck: vi.fn().mockResolvedValue(0),
    pruneCompleted: vi.fn().mockResolvedValue(0),
  };
}

function job(id: string, overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id,
    queue: 'ingestion',
    jobType: 'request',
    priority: 50,
    orgId: 'org-1',
    projectId: 'proj-1',
    payload: { events: [] },
    attempts: 1,
    maxAttempts: 3,
    dedupeKey: `dedupe-${id}`,
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('PgQueueWorker processing behavior', () => {
  it('completes a job only after the handler succeeds', async () => {
    const q = queue();
    const handler = vi.fn().mockResolvedValue(undefined);
    const worker = new PgQueueWorker(q as unknown as PgQueue, handler, logger() as never, {
      workerId: 'worker-1',
    });

    await (worker as unknown as { process: (claimed: ClaimedJob) => Promise<void> }).process(job('job-1'));

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
    expect(q.complete).toHaveBeenCalledWith('job-1', {
      processedBy: 'worker-1',
      durationMs: expect.any(Number),
    });
    expect(q.fail).not.toHaveBeenCalled();

    const stats = worker.drainStats();
    expect(stats.jobsProcessed).toBe(1);
    expect(stats.jobsFailed).toBe(0);
  });

  it('hands failed jobs to queue.fail without acknowledging completion', async () => {
    const q = queue();
    const log = logger();
    const err = new Error('processor crashed');
    err.name = 'ProcessorError';
    const handler = vi.fn().mockRejectedValue(err);
    const worker = new PgQueueWorker(q as unknown as PgQueue, handler, log as never, {
      workerId: 'worker-1',
    });

    await (worker as unknown as { process: (claimed: ClaimedJob) => Promise<void> }).process(job('job-2'));

    expect(q.complete).not.toHaveBeenCalled();
    expect(q.fail).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-2' }), 'processor crashed', 'ProcessorError');
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-2', jobType: 'request', outcome: 'retried', err: 'processor crashed' }),
      'Job failed',
    );

    const stats = worker.drainStats();
    expect(stats.jobsProcessed).toBe(0);
    expect(stats.jobsFailed).toBe(1);
  });

  it('bounds concurrently running handlers inside a claimed batch', async () => {
    const q = queue();
    const releases = [deferred(), deferred(), deferred(), deferred()];
    let active = 0;
    let maxActive = 0;
    const handler: JobHandler = vi.fn(async (claimed) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const release = releases[Number(claimed.id.split('-')[1]) - 1];
      await release?.promise;
      active -= 1;
    });
    const worker = new PgQueueWorker(q as unknown as PgQueue, handler, logger() as never, {
      workerId: 'worker-1',
      handlerConcurrency: 2,
    });
    const run = (worker as unknown as { runBounded: (jobs: ClaimedJob[], limit: number) => Promise<void> })
      .runBounded([job('job-1'), job('job-2'), job('job-3'), job('job-4')], 2);

    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(2);

    releases[0]?.resolve();
    releases[1]?.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    expect(handler).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(2);

    releases[2]?.resolve();
    releases[3]?.resolve();
    await run;
    expect(q.complete).toHaveBeenCalledTimes(4);
  });

  it('runs maintenance recovery and completed-job pruning together', async () => {
    const q = queue();
    q.recoverStuck.mockResolvedValueOnce(2);
    q.pruneCompleted.mockResolvedValueOnce(3);
    const worker = new PgQueueWorker(q as unknown as PgQueue, vi.fn(), logger() as never, {
      workerId: 'worker-1',
      completedRetentionMs: 1234,
    });

    await (worker as unknown as { maintenance: () => Promise<void> }).maintenance();

    expect(q.recoverStuck).toHaveBeenCalledWith(500);
    expect(q.pruneCompleted).toHaveBeenCalledWith(1234, 5000);
  });
});
