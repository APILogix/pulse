import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PgmqWorker } from '../../src/lib/pgmq-worker.js';
import { PgmqClient, type PgmqMessage } from '../../src/lib/pgmq.js';

describe('PgmqWorker Reliability & Lifecycle', () => {
  let mockClient: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = {
      createQueue: vi.fn().mockResolvedValue(undefined),
      readWithPoll: vi.fn().mockResolvedValue([]),
      setVt: vi.fn().mockResolvedValue({ msgId: '1' }),
      delete: vi.fn().mockResolvedValue(true),
      archive: vi.fn().mockResolvedValue(true),
      send: vi.fn().mockResolvedValue('100'),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Normal Processing: reads message, runs handler, acknowledges with delete', async () => {
    const fakeMsg: PgmqMessage = {
      msgId: 'msg-1',
      readCt: 1,
      enqueuedAt: new Date(),
      vt: new Date(Date.now() + 60000),
      message: { data: 'test' },
      headers: null,
    };

    mockClient.readWithPoll.mockResolvedValueOnce([fakeMsg]);

    const handler = vi.fn().mockResolvedValue({ status: 'ok' });
    const onSuccess = vi.fn();

    const worker = new PgmqWorker(mockClient, handler, {
      queue: 'test_queue',
      batchSize: 1,
      concurrency: 1,
      visibilityTimeoutSeconds: 60,
      onJobSuccess: onSuccess,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(50);

    expect(handler).toHaveBeenCalledWith(fakeMsg, expect.any(AbortSignal));
    expect(mockClient.delete).toHaveBeenCalledWith('test_queue', 'msg-1');
    expect(onSuccess).toHaveBeenCalledWith(fakeMsg, expect.any(Number));
    expect(worker.getStats().processed).toBe(1);

    await worker.stop();
  });

  it('Long-running Processing: automatically extends visibility timeout via heartbeat', async () => {
    const fakeMsg: PgmqMessage = {
      msgId: 'msg-long',
      readCt: 1,
      enqueuedAt: new Date(),
      vt: new Date(Date.now() + 60000),
      message: { longTask: true },
      headers: null,
    };

    mockClient.readWithPoll.mockResolvedValueOnce([fakeMsg]);

    let resolveTask: () => void;
    const taskPromise = new Promise<void>((res) => {
      resolveTask = res;
    });

    const handler = vi.fn().mockImplementation(async () => {
      await taskPromise;
    });

    const worker = new PgmqWorker(mockClient, handler, {
      queue: 'test_queue',
      heartbeatIntervalSeconds: 5,
      visibilityTimeoutSeconds: 15,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(10); // Start processing

    // Advance 5 seconds -> first heartbeat
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockClient.setVt).toHaveBeenCalledWith('test_queue', 'msg-long', 15);

    // Advance another 5 seconds -> second heartbeat
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockClient.setVt).toHaveBeenCalledTimes(2);

    // Resolve task
    resolveTask!();
    await vi.advanceTimersByTimeAsync(10);

    expect(mockClient.delete).toHaveBeenCalledWith('test_queue', 'msg-long');
    await worker.stop();
  });

  it('Poison Message / Dead-Lettering: routes to DLQ when read count exceeds maxAttempts', async () => {
    const poisonMsg: PgmqMessage = {
      msgId: 'msg-poison',
      readCt: 6, // Exceeded maxAttempts=5
      enqueuedAt: new Date(),
      vt: new Date(),
      message: { badPayload: true },
      headers: null,
    };

    mockClient.readWithPoll.mockResolvedValueOnce([poisonMsg]);

    const handler = vi.fn();
    const onMaxAttempts = vi.fn();

    const worker = new PgmqWorker(mockClient, handler, {
      queue: 'source_queue',
      deadLetterQueue: 'source_dlq',
      maxAttempts: 5,
      onMaxAttemptsExceeded: onMaxAttempts,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(50);

    // Handler should NOT be called for dead-lettered poison message
    expect(handler).not.toHaveBeenCalled();

    // Routed to DLQ
    expect(mockClient.send).toHaveBeenCalledWith('source_dlq', expect.objectContaining({
      sourceQueue: 'source_queue',
      originalMsgId: 'msg-poison',
      payload: { badPayload: true },
      attempts: 6,
    }));

    // Deleted from source queue
    expect(mockClient.delete).toHaveBeenCalledWith('source_queue', 'msg-poison');
    expect(onMaxAttempts).toHaveBeenCalled();
    expect(worker.getStats().deadLettered).toBe(1);

    await worker.stop();
  });

  it('Processing Failure: does not delete message, allows retry', async () => {
    const failingMsg: PgmqMessage = {
      msgId: 'msg-fail',
      readCt: 2,
      enqueuedAt: new Date(),
      vt: new Date(),
      message: { flaky: true },
      headers: null,
    };

    mockClient.readWithPoll.mockResolvedValueOnce([failingMsg]);

    const handler = vi.fn().mockRejectedValue(new Error('Transient DB glitch'));
    const onFailure = vi.fn();

    const worker = new PgmqWorker(mockClient, handler, {
      queue: 'test_queue',
      maxAttempts: 5,
      onJobFailure: onFailure,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(50);

    // Message should NOT be deleted on transient failure
    expect(mockClient.delete).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(failingMsg, expect.any(Error), true);
    expect(worker.getStats().failed).toBe(1);
    expect(worker.getStats().retried).toBe(1);

    await worker.stop();
  });

  it('Graceful Shutdown: stops polling and drains in-flight jobs', async () => {
    let resolveInFlight: () => void;
    const inFlightPromise = new Promise<void>((r) => {
      resolveInFlight = r;
    });

    const msg: PgmqMessage = {
      msgId: 'msg-drain',
      readCt: 1,
      enqueuedAt: new Date(),
      vt: new Date(),
      message: { heavy: true },
      headers: null,
    };

    mockClient.readWithPoll.mockResolvedValueOnce([msg]);

    const handler = vi.fn().mockImplementation(async () => {
      await inFlightPromise;
    });

    const worker = new PgmqWorker(mockClient, handler, {
      queue: 'test_queue',
      drainTimeoutMs: 5000,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(10);

    expect(worker.getStats().inFlight).toBe(1);

    // Trigger stop
    const stopPromise = worker.stop();

    // Complete in-flight task
    resolveInFlight!();
    await vi.advanceTimersByTimeAsync(200);

    await stopPromise;
    expect(mockClient.delete).toHaveBeenCalledWith('test_queue', 'msg-drain');
    expect(worker.getStats().inFlight).toBe(0);
  });

  it('Adaptive Idle Backoff: increases poll delay on consecutive empty polls and resets on message arrival', async () => {
    mockClient.readWithPoll.mockResolvedValue([]);

    const handler = vi.fn();
    const worker = new PgmqWorker(mockClient, handler, {
      queue: 'test_queue',
      idlePollMs: 100,
      maxIdlePollMs: 1000,
      busyPollMs: 20,
    });

    await worker.start();
    // 1st empty poll happens immediately (at t=0)
    expect(mockClient.readWithPoll).toHaveBeenCalledTimes(1);

    // 1st empty poll sets nextDelay = ~150ms (100 * 1.5)
    await vi.advanceTimersByTimeAsync(80);
    expect(mockClient.readWithPoll).toHaveBeenCalledTimes(1);

    // Advance past 150ms -> 2nd poll triggers
    await vi.advanceTimersByTimeAsync(100);
    expect(mockClient.readWithPoll).toHaveBeenCalledTimes(2);

    // 2nd empty poll sets nextDelay = ~225ms (100 * 1.5^2)
    await vi.advanceTimersByTimeAsync(150);
    expect(mockClient.readWithPoll).toHaveBeenCalledTimes(2); // still waiting

    await vi.advanceTimersByTimeAsync(150);
    expect(mockClient.readWithPoll).toHaveBeenCalledTimes(3);

    // Next return a message: backoff should reset
    const msg: PgmqMessage = {
      msgId: 'msg-reset',
      readCt: 1,
      enqueuedAt: new Date(),
      vt: new Date(),
      message: { reset: true },
      headers: null,
    };
    mockClient.readWithPoll.mockResolvedValueOnce([msg]);

    await vi.advanceTimersByTimeAsync(500);
    expect(handler).toHaveBeenCalledWith(msg, expect.any(AbortSignal));

    await worker.stop();
  });

  it('Non-blocking Short Poll: invokes read() when pollTimeoutSeconds is 0', async () => {
    mockClient.read = vi.fn().mockResolvedValue([]);

    const handler = vi.fn();
    const worker = new PgmqWorker(mockClient, handler, {
      queue: 'test_queue',
      pollTimeoutSeconds: 0,
      batchSize: 10,
      concurrency: 10,
      idlePollMs: 100,
    });

    await worker.start();
    expect(mockClient.read).toHaveBeenCalledWith('test_queue', {
      visibilityTimeoutSeconds: 60,
      quantity: 10,
    });
    expect(mockClient.readWithPoll).not.toHaveBeenCalled();

    await worker.stop();
  });

  it('Heartbeat Loss Guard: aborts task via AbortSignal when consecutive heartbeats fail', async () => {
    const fakeMsg: PgmqMessage = {
      msgId: 'msg-lost-hb',
      readCt: 1,
      enqueuedAt: new Date(),
      vt: new Date(Date.now() + 60000),
      message: { task: true },
      headers: null,
    };

    mockClient.readWithPoll.mockResolvedValueOnce([fakeMsg]);
    mockClient.setVt.mockRejectedValue(new Error('Connection lost to DB'));

    let abortedReceived = false;
    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    const handler = vi.fn().mockImplementation(async (_msg, signal?: AbortSignal) => {
      signal?.addEventListener('abort', () => {
        abortedReceived = true;
        resolveTask();
      });
      await taskPromise;
    });

    const worker = new PgmqWorker(mockClient, handler, {
      queue: 'test_queue',
      heartbeatIntervalSeconds: 2,
      visibilityTimeoutSeconds: 10,
      drainTimeoutMs: 100,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(10); // Task starts

    // 1st heartbeat failure
    await vi.advanceTimersByTimeAsync(2000);
    expect(abortedReceived).toBe(false);

    // 2nd heartbeat failure
    await vi.advanceTimersByTimeAsync(2000);
    expect(abortedReceived).toBe(false);

    // 3rd heartbeat failure -> threshold reached, signal aborted
    await vi.advanceTimersByTimeAsync(2000);
    expect(abortedReceived).toBe(true);

    await worker.stop();
  });

  it('Active Retry Backoff: applies setVt with exponential delay when task fails', async () => {
    const failMsg: PgmqMessage = {
      msgId: 'msg-retry-backoff',
      readCt: 2,
      enqueuedAt: new Date(),
      vt: new Date(Date.now() + 300000), // 300s initial VT
      message: { retryMe: true },
      headers: null,
    };

    mockClient.readWithPoll.mockResolvedValueOnce([failMsg]);
    const handler = vi.fn().mockRejectedValue(new Error('Downstream rate limited'));

    const worker = new PgmqWorker(mockClient, handler, {
      queue: 'test_queue',
      maxAttempts: 5,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(50);

    // setVt must be called with backoff delay (< 60s) instead of staying invisible for 300s
    expect(mockClient.setVt).toHaveBeenCalledWith(
      'test_queue',
      'msg-retry-backoff',
      expect.any(Number),
    );
    const delayArg = mockClient.setVt.mock.calls[0][2];
    expect(delayArg).toBeGreaterThanOrEqual(1);
    expect(delayArg).toBeLessThanOrEqual(60);

    await worker.stop();
  });

  it('Transactional DLQ Routing: executes send and delete in a single client transaction', async () => {
    const exhaustedMsg: PgmqMessage = {
      msgId: 'msg-dlq-tx',
      readCt: 5,
      enqueuedAt: new Date(),
      vt: new Date(),
      message: { poison: true },
      headers: null,
    };

    mockClient.readWithPoll.mockResolvedValueOnce([exhaustedMsg]);

    const mockPoolClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };

    const mockCommandPool = {
      connect: vi.fn().mockResolvedValue(mockPoolClient),
    };

    mockClient.getCommandPool = vi.fn().mockReturnValue(mockCommandPool);
    const handler = vi.fn().mockRejectedValue(new Error('Fatal payload parsing crash'));

    const worker = new PgmqWorker(mockClient, handler, {
      queue: 'source_queue',
      deadLetterQueue: 'dlq_queue',
      maxAttempts: 5,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(50);

    // Verify transaction BEGIN and COMMIT were invoked
    expect(mockCommandPool.connect).toHaveBeenCalled();
    expect(mockPoolClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.send).toHaveBeenCalledWith('dlq_queue', expect.any(Object), {}, mockPoolClient);
    expect(mockClient.delete).toHaveBeenCalledWith('source_queue', 'msg-dlq-tx', mockPoolClient);
    expect(mockPoolClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockPoolClient.release).toHaveBeenCalled();

    await worker.stop();
  });
});
