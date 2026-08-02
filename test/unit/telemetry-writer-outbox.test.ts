import { describe, expect, it, vi } from 'vitest';
import { TelemetryWriter, type ScopedEvent } from '../../src/modules/ingestion/pipeline/telemetry-writer.js';

function errorEvent(): ScopedEvent {
  return {
    orgId: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    environment: 'production',
    event: {
      type: 'error',
      eventId: 'evt_1',
      timestamp: 1_700_000_000_000,
      message: 'boom',
      severity: 'fatal',
    },
  };
}

describe('TelemetryWriter transactional outbox', () => {
  it('persists HTTP error status fields when supplied and omits them for background errors', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        return { rowCount: 2, rows: [{ event_id: 'http-error' }, { event_id: 'cron-error' }] };
      }),
    };

    await new TelemetryWriter(pool as never).writeBatch([
      {
        orgId: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        environment: 'production',
        event: {
          type: 'error',
          eventId: 'http-error',
          timestamp: 1_700_000_000_000,
          message: 'unauthorized',
          statusCode: 401,
          handled: true,
          route: '/admin',
          requestId: 'req-1',
        },
      },
      {
        orgId: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        environment: 'production',
        event: {
          type: 'error',
          eventId: 'cron-error',
          timestamp: 1_700_000_000_000,
          message: 'cron failed',
          mechanism: 'cron',
          handled: false,
        },
      },
    ]);

    const insert = queries.find((q) => q.sql.startsWith('INSERT INTO events_errors'));
    expect(insert?.sql).toContain('status_code');
    expect(insert?.sql).toContain('status_text');
    expect(insert?.sql).toContain('handled');
    expect(insert?.values).toContain(401);
    expect(insert?.values).toContain('Unauthorized');
    expect(insert?.values).toContain(true);
    expect(insert?.values).toContain(false);
    expect(insert?.values).not.toContain(500);
    expect(insert?.values).not.toContain(0);
  });

  it('commits telemetry and outbox rows in one transaction', async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.startsWith('INSERT INTO events_errors')) {
          return { rowCount: 1, rows: [{ event_id: 'evt_1' }] };
        }
        if (sql.startsWith('INSERT INTO telemetry_outbox')) {
          return { rowCount: 1, rows: [{ id: '1' }] };
        }
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };

    const result = await new TelemetryWriter(pool as never).writeBatchDetailedWithOutbox([errorEvent()]);

    expect(result.totalInserted).toBe(1);
    expect(calls[0]).toBe('BEGIN');
    expect(calls.some((sql) => sql.startsWith('INSERT INTO events_errors'))).toBe(true);
    expect(calls.some((sql) => sql.startsWith('INSERT INTO telemetry_outbox'))).toBe(true);
    expect(calls.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back when the outbox insert fails', async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.startsWith('INSERT INTO events_errors')) {
          return { rowCount: 1, rows: [{ event_id: 'evt_1' }] };
        }
        if (sql.startsWith('INSERT INTO telemetry_outbox')) {
          throw new Error('outbox failed');
        }
        return { rowCount: 0, rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };

    await expect(
      new TelemetryWriter(pool as never).writeBatchDetailedWithOutbox([errorEvent()]),
    ).rejects.toThrow('outbox failed');

    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
