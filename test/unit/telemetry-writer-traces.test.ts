import { describe, expect, it, vi } from 'vitest';
import {
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
