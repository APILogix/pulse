import { describe, expect, it, vi } from 'vitest';
import { DeliveryFlight } from '../../src/modules/projects/sdk-config/delivery-flight.js';
import { recentEventLoopDelaySampler, recentUtilizationSampler } from '../../src/lib/recent-utilization.js';

describe('bounded SDK lookup flights', () => {
  it('times out callers without releasing a still-running database operation', async () => {
    vi.useFakeTimers();
    try {
      const flights = new DeliveryFlight<number>(1);
      let finish!: (value: number) => void;
      const pending = flights.run('a', () => new Promise<number>(resolve => { finish = resolve; }));
      const assertion = expect(pending).rejects.toMatchObject({ statusCode: 503 });
      await vi.advanceTimersByTimeAsync(1250);
      await assertion;
      await expect(flights.run('b', async () => 2)).rejects.toMatchObject({ statusCode: 503 });
      finish(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(await flights.run('b', async () => 2)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('shares concurrent work but revalidates after completion', async () => {
    const flights = new DeliveryFlight<number>();
    const load = vi.fn(async () => 42);
    expect(await Promise.all(Array.from({ length: 100 }, () => flights.run('key', load)))).toEqual(Array(100).fill(42));
    expect(load).toHaveBeenCalledTimes(1);
    await flights.run('key', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('bounds distinct work and followers, then releases capacity on failure', async () => {
    const flights = new DeliveryFlight<number>(1, 2);
    let reject!: (error: Error) => void;
    const load = () => new Promise<number>((_resolve, fail) => { reject = fail; });
    const first = flights.run('a', load);
    const second = flights.run('a', load);
    const settled = Promise.allSettled([first, second]);
    await expect(flights.run('b', load)).rejects.toMatchObject({ statusCode: 503 });
    await expect(flights.run('a', load)).rejects.toMatchObject({ statusCode: 503 });
    reject(new Error('database unavailable'));
    expect((await settled).every(result => result.status === 'rejected')).toBe(true);
    expect(await flights.run('b', async () => 1)).toBe(1);
  });
});

it('recovers CPU admission after a busy startup sample', () => {
  const values = [
    { active: 0, idle: 0, utilization: 0 },
    { active: 1000, idle: 0, utilization: 1 },
    { active: 1010, idle: 990, utilization: 0.505 },
  ];
  const sample = recentUtilizationSampler(() => values.shift()!);
  expect(sample()).toBe(1);
  expect(sample()).toBeCloseTo(0.01);
});

it('safely handles zero-sample intervals in event loop delay without NaN or Infinity', () => {
  let count = 0;
  let mean = NaN;
  const mockHistogram = {
    get count() { return count; },
    get mean() { return mean; },
    enable: vi.fn(),
    reset: vi.fn(),
  };

  const sample = recentEventLoopDelaySampler(10, () => mockHistogram as any);
  // Interval 1: 0 samples recorded (idle or timer alignment drift) -> must return 0, NOT NaN or Infinity
  expect(sample()).toBe(0);

  // Interval 2: 10 samples recorded with mean 25ms (in nanoseconds: 25 * 1e6) -> returns 15ms (25ms - 10ms resolution)
  count = 10;
  mean = 25 * 1e6;
  expect(sample()).toBe(15);

  // Interval 3: count resets back to 0 -> returns 0
  count = 0;
  mean = NaN;
  expect(sample()).toBe(0);
});
