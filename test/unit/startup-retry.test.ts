import { describe, expect, it, vi } from 'vitest';
import { retryTransientStartupOperation } from '../../src/config/startup-retry.js';

describe('retryTransientStartupOperation', () => {
  it('retries a transient database connection failure with a bounded backoff', async () => {
    vi.useFakeTimers();
    const connect = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }))
      .mockResolvedValueOnce('connected');
    const onRetry = vi.fn();

    const pending = retryTransientStartupOperation('primary database', connect, {
      baseDelayMs: 10,
      onRetry,
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe('connected');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, maxAttempts: 3, delayMs: 10 }));
    vi.useRealTimers();
  });

  it('does not retry non-transient configuration failures', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('password authentication failed'));

    await expect(retryTransientStartupOperation('primary database', connect)).rejects.toThrow(
      'password authentication failed',
    );
    expect(connect).toHaveBeenCalledOnce();
  });

  it('caps exponential backoff at maxDelayMs', async () => {
    vi.useFakeTimers();
    const transient = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const connect = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce('connected');
    const onRetry = vi.fn();

    const pending = retryTransientStartupOperation('primary database', connect, {
      maxAttempts: 5,
      baseDelayMs: 100,
      maxDelayMs: 250,
      onRetry,
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe('connected');
    expect(onRetry.mock.calls.map(([details]) => details.delayMs)).toEqual([100, 200, 250]);
    vi.useRealTimers();
  });

  it('stops after the configured retry budget', async () => {
    vi.useFakeTimers();
    const connect = vi.fn().mockRejectedValue(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }));
    const pending = retryTransientStartupOperation('primary database', connect, {
      maxAttempts: 2,
      baseDelayMs: 10,
    });
    const rejection = expect(pending).rejects.toThrow('connect ETIMEDOUT');
    await vi.runAllTimersAsync();

    await rejection;
    expect(connect).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
