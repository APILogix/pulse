import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import dns from 'node:dns';
import { UsageCounter } from '../../src/modules/ingestion/usage/usage-counter.js';

describe('UsageCounter & Connection Resilience', () => {
  let mockPool: any;
  let mockLogger: any;
  let counter: UsageCounter;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
    };
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    counter = new UsageCounter(mockPool, mockLogger, {
      flushIntervalMs: 60000,
      bufferLimit: 100,
      driveRollup: false,
    });
  });

  afterEach(async () => {
    await counter.stop().catch(() => {});
  });

  it('verifies global DNS resolution order is set to ipv4first', () => {
    if (typeof dns.getDefaultResultOrder === 'function') {
      expect(dns.getDefaultResultOrder()).toBe('ipv4first');
    }
  });

  it('buffers and flushes counts to usage_counter_staging with schema check', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    counter.increment('proj-1', 'org-1', 'requests', 5, { eventType: 'log' });
    counter.increment('proj-1', 'org-1', 'events', 10, { eventType: 'log' });

    await counter.flush();

    // ensureSchema called
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE UNLOGGED TABLE IF NOT EXISTS usage_counter_staging'),
      undefined,
    );

    // INSERT called
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO usage_counter_staging'),
      expect.arrayContaining(['proj-1', 'org-1', null, 'log', 'requests', 5]),
    );
  });

  it('retries on transient disconnect (Connection terminated unexpectedly) and recovers', async () => {
    const transientError: any = new Error('Connection terminated unexpectedly');
    transientError.code = 'ECONNRESET';

    // 1. schema creation succeeds
    // 2. first insert attempt fails with transient error
    // 3. second insert attempt succeeds
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // schema
      .mockRejectedValueOnce(transientError) // 1st insert fails
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // 2nd insert succeeds

    counter.increment('proj-1', 'org-1', 'events', 25);

    await expect(counter.flush()).resolves.toBeUndefined();

    // Verify debug retry logged
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1 }),
      expect.stringContaining('Transient database error in UsageCounter query; retrying...'),
    );
  });

  it('preserves buffer and re-buffers counts when flush fails permanently', async () => {
    const permanentError = new Error('Permanent database crash');

    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // schema
      .mockRejectedValue(permanentError); // all inserts fail

    counter.increment('proj-1', 'org-1', 'errors', 3);

    await expect(counter.flush()).rejects.toThrow('Permanent database crash');

    // Counts remain buffered and warn is logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ bufferedEntries: 1 }),
      'UsageCounter staging flush failed; counts re-buffered',
    );
  });
});
