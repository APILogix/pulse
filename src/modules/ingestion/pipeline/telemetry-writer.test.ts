/**
 * telemetry-writer.test.ts — batching invariants for the ingestion write path.
 *
 * The whole point of the write path is that DB work scales with the number of
 * STATEMENTS, not the number of events. These tests pin that:
 *
 *   1. N events of one type -> exactly ONE multi-row INSERT (not N inserts).
 *   2. Every insert is `ON CONFLICT DO NOTHING` (at-least-once delivery safety).
 *   3. Traces flatten their span tree into a set-based insert, not per-span.
 *   4. A span tree large enough to exceed PostgreSQL's 65535 bind-parameter
 *      limit is split across statements instead of being rejected.
 *
 * Invariant 4 is a regression guard. `events_spans` has 67 columns, so a single
 * statement tops out at floor(65535/67) = 978 rows. Trace ingestion is the only
 * 1-event -> N-rows writer, and it previously emitted one unbounded INSERT — so
 * 200 traces averaging 5 spans (1000 rows) was enough for PostgreSQL to reject
 * the statement, fail the job, exhaust its retries and dead-letter the batch.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

interface Call {
  sql: string;
  values: unknown[];
}

const calls: Call[] = [];

const db = {
  query: vi.fn(async (sql: unknown, values?: unknown[]) => {
    calls.push({ sql: String(sql), values: values ?? [] });
    return { rows: [], rowCount: 0 };
  }),
};

vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    INGESTION_LOG_DB_SYNCHRONOUS_COMMIT: 'on',
    INGESTION_LOG_DB_LOCK_TIMEOUT_MS: 2000,
    INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS: 60000,
    INGESTION_LOG_DB_IDLE_TX_TIMEOUT_MS: 30000,
    INGESTION_FAST_REQUEST_MIN_DURATION_MS: 1000,
    LOG_DB_WRITE_TIMEOUT: 0,
  },
}));

vi.mock('../../../config/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

/** Statements that insert into a given table. */
function insertsInto(table: string): Call[] {
  return calls.filter((c) => new RegExp(`INSERT INTO ${table}\\b`, 'i').test(c.sql));
}

/** Count `(...)` VALUES tuples in a multi-row INSERT. */
function tupleCount(sql: string): number {
  const values = sql.slice(sql.toUpperCase().indexOf(' VALUES ') + 8);
  return (values.match(/\(\s*\$/g) ?? []).length;
}

let TelemetryWriter: typeof import('./telemetry-writer.js')['TelemetryWriter'];

beforeEach(async () => {
  calls.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
  ({ TelemetryWriter } = await import('./telemetry-writer.js'));
});

/** Minimal scoped event factory. */
function scopedLog(i: number) {
  return {
    orgId: '11111111-1111-1111-1111-111111111111',
    projectId: '22222222-2222-2222-2222-222222222222',
    environment: 'production',
    apiKeyName: 'test-key',
    event: {
      type: 'log' as const,
      eventId: `evt-log-${i}`,
      timestamp: Date.now(),
      level: 'info',
      message: `message ${i}`,
    },
  };
}

/** Build a trace whose root span has `spanCount` children (flat, depth 1). */
function scopedTrace(i: number, childCount: number) {
  const children = Array.from({ length: childCount }, (_, c) => ({
    spanId: `span-${i}-${c}`,
    name: `child ${c}`,
    kind: 'internal',
    status: 'ok',
    duration: 1,
    children: [],
  }));
  return {
    orgId: '11111111-1111-1111-1111-111111111111',
    projectId: '22222222-2222-2222-2222-222222222222',
    environment: 'production',
    apiKeyName: 'test-key',
    event: {
      type: 'trace' as const,
      eventId: `evt-trace-${i}`,
      timestamp: Date.now(),
      traceId: `trace-${i}`,
      spanCount: childCount + 1,
      totalDuration: 10,
      rootSpan: {
        spanId: `span-${i}-root`,
        name: 'root',
        kind: 'server',
        status: 'ok',
        duration: 10,
        children,
      },
    },
  };
}

describe('TelemetryWriter batching', () => {
  it('writes N same-type events as ONE multi-row INSERT, not N inserts', async () => {
    const writer = new TelemetryWriter(db as never, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);
    const batch = Array.from({ length: 50 }, (_, i) => scopedLog(i));

    await writer.writeBatchDetailedInTransaction(db as never, batch as never);

    const inserts = insertsInto('events_logs');
    expect(inserts).toHaveLength(1);
    expect(tupleCount(inserts[0]!.sql)).toBe(50);
  });

  it('uses a precomputed scoped occurrence time instead of a per-write clock fallback', async () => {
    const writer = new TelemetryWriter(db as never, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);
    const occurredAtMs = Date.parse('2026-08-24T00:00:00.000Z');
    const scoped = scopedLog(1) as ReturnType<typeof scopedLog> & { occurredAtMs: number };
    scoped.occurredAtMs = occurredAtMs;
    delete (scoped.event as { timestamp?: number }).timestamp;

    await writer.writeBatchDetailedInTransaction(db as never, [scoped] as never);

    const values = insertsInto('events_logs')[0]?.values ?? [];
    // events_logs occurred_at is column 36 (zero-based value index 35).
    expect(values[35]).toBe(new Date(occurredAtMs).toISOString());
  });

  it('makes every insert idempotent with ON CONFLICT DO NOTHING', async () => {
    const writer = new TelemetryWriter(db as never, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);

    await writer.writeBatchDetailedInTransaction(db as never, [scopedLog(1)] as never);

    const inserts = calls.filter((c) => /INSERT INTO/i.test(c.sql));
    expect(inserts.length).toBeGreaterThan(0);
    for (const call of inserts) {
      expect(call.sql).toContain('ON CONFLICT DO NOTHING');
    }
  });

  it('flattens a trace span tree into a set-based insert, one statement per batch', async () => {
    const writer = new TelemetryWriter(db as never, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);
    // 4 traces x (1 root + 3 children) = 16 span rows.
    const batch = Array.from({ length: 4 }, (_, i) => scopedTrace(i, 3));

    await writer.writeBatchDetailedInTransaction(db as never, batch as never);

    expect(insertsInto('events_traces')).toHaveLength(1);

    const spanInserts = insertsInto('events_spans');
    expect(spanInserts).toHaveLength(1);
    expect(tupleCount(spanInserts[0]!.sql)).toBe(16);
  });

  it('splits an oversized span tree across statements instead of exceeding 65535 bind params', async () => {
    const writer = new TelemetryWriter(db as never, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);
    // 2 traces x (1 root + 799 children) = 1600 span rows, above the 978 ceiling.
    const batch = Array.from({ length: 2 }, (_, i) => scopedTrace(i, 799));

    await writer.writeBatchDetailedInTransaction(db as never, batch as never);

    const spanInserts = insertsInto('events_spans');
    // Must be chunked, and every chunk must respect the hard protocol limit.
    expect(spanInserts.length).toBeGreaterThan(1);
    for (const call of spanInserts) {
      expect(call.values.length).toBeLessThanOrEqual(65535);
      expect(call.sql).toContain('ON CONFLICT DO NOTHING');
    }
    // No rows lost in the split.
    const total = spanInserts.reduce((n, c) => n + tupleCount(c.sql), 0);
    expect(total).toBe(1600);
  });

  it('keeps a single statement when the span tree fits under the limit', async () => {
    const writer = new TelemetryWriter(db as never, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);
    // 1 trace x (1 root + 500 children) = 501 rows, under the 978 ceiling.
    await writer.writeBatchDetailedInTransaction(db as never, [scopedTrace(0, 500)] as never);

    const spanInserts = insertsInto('events_spans');
    expect(spanInserts).toHaveLength(1);
    expect(tupleCount(spanInserts[0]!.sql)).toBe(501);
  });

  it('groups a mixed batch by type: one INSERT per type, not per event', async () => {
    const writer = new TelemetryWriter(db as never, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);
    const batch = [
      ...Array.from({ length: 10 }, (_, i) => scopedLog(i)),
      ...Array.from({ length: 5 }, (_, i) => scopedTrace(i, 1)),
    ];

    await writer.writeBatchDetailedInTransaction(db as never, batch as never);

    expect(insertsInto('events_logs')).toHaveLength(1);
    expect(tupleCount(insertsInto('events_logs')[0]!.sql)).toBe(10);
    expect(insertsInto('events_traces')).toHaveLength(1);
    expect(tupleCount(insertsInto('events_traces')[0]!.sql)).toBe(5);
  });
});
