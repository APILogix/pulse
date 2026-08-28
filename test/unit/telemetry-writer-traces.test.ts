import { describe, expect, it, vi } from 'vitest';
import {
  normalizeEvent,
  normalizeTimestampToEpochMs,
  parseSafeEpochMs,
  resolveTimestamp,
} from '../../src/modules/ingestion/pipeline/event-normalizer.js';
import {
  TelemetryWriter,
  parseSafeIsoTimestamp,
  type ScopedEvent,
} from '../../src/modules/ingestion/pipeline/telemetry-writer.js';

describe('Timestamp Normalization & Parsing', () => {
  it('parses integer millisecond timestamps', () => {
    expect(parseSafeEpochMs(1786963046732)).toBe(1786963046732);
    expect(parseSafeIsoTimestamp(1786963046732)).toBe(new Date(1786963046732).toISOString());
  });

  it('parses fractional millisecond timestamps accurately', () => {
    expect(parseSafeEpochMs(1786963046966.2644)).toBe(1786963046966);
    expect(parseSafeIsoTimestamp(1786963046966.2644)).toBe(new Date(1786963046966).toISOString());
  });

  it('parses numeric string timestamps', () => {
    expect(parseSafeEpochMs('1786963046732')).toBe(1786963046732);
    expect(parseSafeIsoTimestamp('1786963046732')).toBe(new Date(1786963046732).toISOString());

    expect(parseSafeEpochMs('1786963046966.2644')).toBe(1786963046966);
    expect(parseSafeIsoTimestamp('1786963046966.2644')).toBe(new Date(1786963046966).toISOString());
  });

  it('parses ISO date strings', () => {
    const isoString = '2026-08-17T10:45:00.000Z';
    const expectedMs = Date.parse(isoString);
    expect(parseSafeEpochMs(isoString)).toBe(expectedMs);
    expect(parseSafeIsoTimestamp(isoString)).toBe(isoString);
  });

  it('normalizes supported SDK timestamp formats at validation', () => {
    const isoString = '2026-08-17T10:45:00.000Z';
    const normalizedIso = normalizeEvent({
      type: 'log',
      level: 'info',
      message: 'ok',
      timestamp: isoString,
    });

    expect(normalizedIso.ok).toBe(true);
    if (normalizedIso.ok) {
      expect(normalizedIso.event.timestamp).toBe(Date.parse(isoString));
    }

    const normalizedSeconds = normalizeEvent({
      type: 'error',
      message: 'boom',
      timestamp: '1786963046',
    });

    expect(normalizedSeconds.ok).toBe(true);
    if (normalizedSeconds.ok) {
      expect(normalizedSeconds.event.timestamp).toBe(1786963046000);
    }
  });

  it('rejects malformed explicit timestamps instead of silently defaulting', () => {
    const normalized = normalizeEvent({
      type: 'log',
      level: 'info',
      message: 'bad timestamp',
      timestamp: 'not-a-timestamp',
    });

    expect(normalized.ok).toBe(false);
    if (!normalized.ok) {
      expect(normalized.reason).toBe('validation_failed');
      expect(normalized.detail).toContain('timestamp');
    }
  });

  it('allows missing timestamps and clamps far-future timestamps to now', () => {
    const now = Date.parse('2026-08-24T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const missing = normalizeEvent({
        type: 'log',
        level: 'info',
        message: 'no timestamp',
      });
      expect(missing.ok).toBe(true);

      expect(normalizeTimestampToEpochMs('2035-01-01T00:00:00.000Z')).toBe(now);
    } finally {
      vi.useRealTimers();
    }
  });

  it('parses seconds, microseconds, and nanoseconds to milliseconds', () => {
    // Seconds (~1.78e9)
    expect(parseSafeEpochMs(1786963046)).toBe(1786963046000);
    // Microseconds (~1.78e15)
    expect(parseSafeEpochMs(1786963046732000)).toBe(1786963046732);
    // Nanoseconds (~1.78e18)
    expect(parseSafeEpochMs(1786963046732000000)).toBe(1786963046732);
  });

  it('returns null for missing, null, undefined, or empty values', () => {
    expect(parseSafeEpochMs(null)).toBeNull();
    expect(parseSafeEpochMs(undefined)).toBeNull();
    expect(parseSafeEpochMs('')).toBeNull();
    expect(parseSafeEpochMs('   ')).toBeNull();

    expect(parseSafeIsoTimestamp(null)).toBeNull();
    expect(parseSafeIsoTimestamp(undefined)).toBeNull();
    expect(parseSafeIsoTimestamp('')).toBeNull();
  });

  it('handles invalid timestamps safely without throwing RangeError', () => {
    const warns: unknown[] = [];
    const logger = {
      warn: vi.fn((data: unknown) => warns.push(data)),
      debug: vi.fn(),
    };

    expect(parseSafeEpochMs(NaN)).toBeNull();
    expect(parseSafeEpochMs(Infinity)).toBeNull();
    expect(parseSafeEpochMs(-Infinity)).toBeNull();
    expect(parseSafeEpochMs('invalid-date-string')).toBeNull();
    expect(parseSafeEpochMs({})).toBeNull();

    expect(
      parseSafeIsoTimestamp(NaN, {
        traceId: 'trc-1',
        spanId: 'spn-1',
        field: 'startTime',
        logger,
      }),
    ).toBeNull();

    expect(
      parseSafeIsoTimestamp('not-a-timestamp', {
        traceId: 'trc-2',
        spanId: 'spn-2',
        field: 'endTime',
        logger,
      }),
    ).toBeNull();

    expect(warns.length).toBeGreaterThan(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trc-1',
        spanId: 'spn-1',
        field: 'startTime',
      }),
      expect.any(String),
    );
  });
});

describe('Trace resolveTimestamp', () => {
  it('resolves timestamp from rootSpan.startTime when top-level timestamp is absent', () => {
    const traceEvent: any = {
      type: 'trace',
      traceId: 'trace-abc-123',
      spanCount: 1,
      rootSpan: {
        id: 'span-root-1',
        startTime: 1786963046732,
      },
    };

    const resolved = resolveTimestamp(traceEvent);
    expect(resolved).toBe(1786963046732);
  });

  it('resolves fractional milliseconds from rootSpan.startTime', () => {
    const traceEvent: any = {
      type: 'trace',
      traceId: 'trace-abc-123',
      spanCount: 1,
      rootSpan: {
        id: 'span-root-1',
        startTime: 1786963046966.2644,
      },
    };

    const resolved = resolveTimestamp(traceEvent);
    expect(resolved).toBe(1786963046966);
  });

  it('normalizes trace root span timestamps before storage resolution', () => {
    const isoString = '2026-08-17T10:45:00.000Z';
    const normalized = normalizeEvent({
      type: 'trace',
      traceId: 'trace-abc-123',
      spanCount: 1,
      rootSpan: {
        id: 'span-root-1',
        startTime: isoString,
      },
    });

    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      const rootSpan = normalized.event.rootSpan as Record<string, unknown>;
      expect(rootSpan.startTime).toBe(Date.parse(isoString));
      expect(resolveTimestamp(normalized.event)).toBe(Date.parse(isoString));
    }
  });
});

describe('Trace structural validation', () => {
  function traceWithDepth(depth: number): Record<string, unknown> {
    const root: Record<string, unknown> = { id: 'span-0', name: 'root' };
    let current = root;
    for (let index = 1; index <= depth; index += 1) {
      const child: Record<string, unknown> = { id: `span-${index}`, name: `span ${index}` };
      current.children = [child];
      current = child;
    }
    return root;
  }

  it('uses an explicit receipt clock for deterministic clamping and fallback', () => {
    const receivedAtMs = Date.parse('2026-08-24T00:00:00.000Z');
    const first = normalizeEvent({
      type: 'log',
      level: 'info',
      message: 'future clock',
      timestamp: '2035-01-01T00:00:00.000Z',
    }, { nowMs: receivedAtMs });
    const second = normalizeEvent({
      type: 'log',
      level: 'info',
      message: 'future clock',
      timestamp: '2035-01-01T00:00:00.000Z',
    }, { nowMs: receivedAtMs });

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.event.timestamp).toBe(receivedAtMs);

    const missing = normalizeEvent({ type: 'log', level: 'info', message: 'missing clock' }, { nowMs: receivedAtMs });
    expect(missing.ok).toBe(true);
    if (missing.ok) {
      expect(resolveTimestamp(missing.event, {
        nowMs: receivedAtMs,
        fallbackMs: receivedAtMs,
      })).toBe(receivedAtMs);
    }
  });

  it('accepts trace depth 128 and rejects depth 129 before storage', () => {
    const accepted = normalizeEvent({
      type: 'trace',
      traceId: 'trace-depth-128',
      spanCount: 129,
      rootSpan: traceWithDepth(128),
    });
    expect(accepted.ok).toBe(true);

    const rejected = normalizeEvent({
      type: 'trace',
      traceId: 'trace-depth-129',
      spanCount: 130,
      rootSpan: traceWithDepth(129),
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.reason).toBe('validation_failed');
      expect(rejected.detail).toContain('maximum depth 128');
    }
  });

  it('bounds actual trace nodes independently of the declared spanCount', () => {
    const children = Array.from({ length: 10_000 }, (_, index) => ({
      id: `child-${index}`,
      name: `child ${index}`,
    }));
    const result = normalizeEvent({
      type: 'trace',
      traceId: 'trace-node-limit',
      spanCount: 1,
      rootSpan: { id: 'root', name: 'root', children },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain('maximum node count 10000');
  });

  it('rejects malformed children, cycles, and shared span references', () => {
    const malformed = normalizeEvent({
      type: 'trace',
      traceId: 'trace-malformed',
      spanCount: 1,
      rootSpan: { id: 'root', children: [null] },
    });
    expect(malformed.ok).toBe(false);

    const cyclicRoot: Record<string, unknown> = { id: 'root' };
    cyclicRoot.children = [cyclicRoot];
    const cyclic = normalizeEvent({
      type: 'trace',
      traceId: 'trace-cycle',
      spanCount: 1,
      rootSpan: cyclicRoot,
    });
    expect(cyclic.ok).toBe(false);
    if (!cyclic.ok) expect(cyclic.detail).toContain('cycles and shared span references');

    const child = { id: 'shared' };
    const shared = normalizeEvent({
      type: 'trace',
      traceId: 'trace-shared',
      spanCount: 3,
      rootSpan: { id: 'root', children: [child, child] },
    });
    expect(shared.ok).toBe(false);
    if (!shared.ok) expect(shared.detail).toContain('cycles and shared span references');
  });

  it('keeps a JSON-parsed __proto__ field from becoming an inherited child subtree', () => {
    const rootSpan = JSON.parse(
      '{"id":"root","name":"root","__proto__":{"children":[{"id":"hidden-child"}]}}',
    ) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(rootSpan, '__proto__')).toBe(true);

    const normalized = normalizeEvent({
      type: 'trace',
      traceId: 'trace-proto-key',
      spanCount: 1,
      rootSpan,
    });

    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      const normalizedRoot = normalized.event.rootSpan as Record<string, unknown>;
      expect(Object.getPrototypeOf(normalizedRoot)).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(normalizedRoot, '__proto__')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(normalizedRoot, 'children')).toBe(false);
      expect(normalizedRoot.children).toBeUndefined();
    }
  });
});

describe('TelemetryWriter Trace & Span Tree Ingestion', () => {
  it('writes root span and deeply nested child spans with resilient timestamps', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        return { rowCount: 1, rows: [{ id: '1' }] };
      }),
    };

    const logger = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const writer = new TelemetryWriter(pool as never, logger as never);

    const rootStartTime = 1786963046732;
    const childStartTime = 1786963046966.2644;
    const grandchildStartTime = '1786963046976';

    const scoped: ScopedEvent = {
      orgId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      environment: 'production',
      event: {
        type: 'trace',
        eventId: 'trace-evt-1',
        traceId: 'trace-uuid-1',
        spanCount: 4,
        totalDuration: 500,
        rootSpan: {
          id: 'root-span-1',
          name: 'HTTP GET /api/orders',
          kind: 'SERVER',
          startTime: rootStartTime,
          endTime: rootStartTime + 500,
          duration: 500,
          attributes: { 'http.route': '/api/orders', 'http.method': 'GET' },
          children: [
            {
              id: 'child-span-1',
              name: 'authenticate',
              kind: 'INTERNAL',
              startTime: childStartTime,
              duration: 50,
              // endTime not supplied, should derive from startTime + duration
              children: [
                {
                  id: 'grandchild-span-1',
                  name: 'db.query SELECT users',
                  kind: 'CLIENT',
                  startTime: grandchildStartTime,
                  endTime: 1786963047026,
                  duration: 50,
                  attributes: { 'db.system': 'postgresql' },
                  children: [
                    {
                      id: 'great-grandchild-span-1',
                      name: 'cache.get session',
                      kind: 'CLIENT',
                      // startTime missing, duration supplied
                      duration: 10,
                    },
                  ],
                },
              ],
            },
          ],
        },
      } as any,
    };

    const result = await writer.writeBatchDetailed([scoped]);
    expect(result.totalInserted).toBe(1);

    const spansInsert = queries.find((q) => q.sql.includes('events_spans'));
    expect(spansInsert).toBeDefined();

    const COL_COUNT = 67; // events_spans column count
    const values = spansInsert?.values ?? [];

    // Verify root span row values (row 0: index 0..59)
    const rootRow = values.slice(0, COL_COUNT);
    expect(rootRow[4]).toBe('root-span-1');
    expect(rootRow[18]).toBe(new Date(rootStartTime).toISOString());
    expect(rootRow[19]).toBe(new Date(rootStartTime + 500).toISOString());

    // Verify child span row values (row 1: index 60..119)
    const childRow = values.slice(COL_COUNT, COL_COUNT * 2);
    expect(childRow[4]).toBe('child-span-1');
    // startTime (index 18) for child should be ISO string of Math.round(1786963046966.2644)
    expect(childRow[18]).toBe(new Date(1786963046966).toISOString());
    // derived endTime (index 19) should be startTime (1786963046966) + duration (50) = 1786963047016
    expect(childRow[19]).toBe(new Date(1786963047016).toISOString());

    // Verify grandchild row (row 2: index 120..179)
    const grandchildRow = values.slice(COL_COUNT * 2, COL_COUNT * 3);
    expect(grandchildRow[4]).toBe('grandchild-span-1');
    expect(grandchildRow[18]).toBe(new Date(1786963046976).toISOString());
    expect(grandchildRow[19]).toBe(new Date(1786963047026).toISOString());

    // Verify great-grandchild row (row 3: index 180..239)
    const greatGrandchildRow = values.slice(COL_COUNT * 3, COL_COUNT * 4);
    expect(greatGrandchildRow[4]).toBe('great-grandchild-span-1');
    expect(greatGrandchildRow[18]).toBeNull(); // startTime is null
    expect(greatGrandchildRow[22]).toBe(new Date(rootStartTime).toISOString()); // occurred_at (index 22) falls back to trace timestamp
  });

  it('does not throw when encountering malformed timestamps and logs structured warnings', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        return { rowCount: 1, rows: [{ id: '1' }] };
      }),
    };

    const logger = {
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const writer = new TelemetryWriter(pool as never, logger as never);

    const scoped: ScopedEvent = {
      orgId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      environment: 'production',
      event: {
        type: 'trace',
        eventId: 'trace-evt-corrupt',
        traceId: 'trace-uuid-corrupt',
        spanCount: 1,
        rootSpan: {
          id: 'root-corrupt',
          name: 'corrupt-span',
          startTime: 'INVALID_DATE_VALUE',
          endTime: NaN,
          duration: 100,
        },
      } as any,
    };

    // Must NOT throw RangeError: Invalid time value
    await expect(writer.writeBatchDetailed([scoped])).resolves.toBeDefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-uuid-corrupt',
        spanId: 'root-corrupt',
        field: 'startTime',
      }),
      expect.any(String),
    );
  });
});
