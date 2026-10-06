import { describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../../src/modules/ingestion/pipeline/telemetry-writer.js';
import { TelemetryWriter } from '../../src/modules/ingestion/pipeline/telemetry-writer.js';

describe('TelemetryWriter session tracking batching (INGEST-Q001)', () => {
  it('batches session tracking into a single UNNEST query rather than N sequential queries', async () => {
    const executedQueries: Array<{ text: string; values: unknown[] }> = [];
    const mockDb: Queryable = {
      query: vi.fn(async (text: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
        if (typeof text === 'string') {
          executedQueries.push({ text, values: values ?? [] });
        } else {
          executedQueries.push({ text: text.text, values: text.values ?? [] });
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const writer = new TelemetryWriter({} as any);

    // Create 10 events across 3 distinct sessions
    const scoped = [
      {
        orgId: '11111111-1111-1111-1111-111111111111',
        projectId: '22222222-2222-2222-2222-222222222222',
        environment: 'production',
        event: {
          type: 'request',
          sessionId: 'sess_A',
          userId: 'user_1',
          timestamp: 1700000000000,
        } as any,
      },
      {
        orgId: '11111111-1111-1111-1111-111111111111',
        projectId: '22222222-2222-2222-2222-222222222222',
        environment: 'production',
        event: {
          type: 'error',
          sessionId: 'sess_A',
          userId: 'user_1',
          handled: false,
          timestamp: 1700000010000,
        } as any,
      },
      {
        orgId: '11111111-1111-1111-1111-111111111111',
        projectId: '22222222-2222-2222-2222-222222222222',
        environment: 'production',
        event: {
          type: 'request',
          sessionId: 'sess_B',
          userId: 'user_2',
          timestamp: 1700000020000,
        } as any,
      },
      {
        orgId: '11111111-1111-1111-1111-111111111111',
        projectId: '22222222-2222-2222-2222-222222222222',
        environment: 'production',
        event: {
          type: 'request',
          sessionId: 'sess_C',
          userId: null,
          timestamp: 1700000030000,
        } as any,
      },
    ];

    await (writer as any).recordSessions(scoped, mockDb);

    // CRUCIAL: Exactly 1 query executed for all sessions instead of 3 queries!
    expect(executedQueries.length).toBe(1);
    const query = executedQueries[0]!;
    expect(query.text).toContain('FROM UNNEST(');
    expect(query.text).toContain('analytics_user_sessions');

    // Check array lengths in values: 10 parameters (one array per column)
    expect(query.values.length).toBe(10);
    const sessionIds = query.values[2] as string[];
    expect(sessionIds).toHaveLength(3);
    expect(sessionIds).toContain('sess_A');
    expect(sessionIds).toContain('sess_B');
    expect(sessionIds).toContain('sess_C');

    // Check that sess_A accumulated 2 events and 1 error and is marked crashed (handled: false)
    const sessAIndex = sessionIds.indexOf('sess_A');
    const eventCounts = query.values[7] as number[];
    const errorCounts = query.values[8] as number[];
    const isCrashed = query.values[9] as boolean[];

    expect(eventCounts[sessAIndex]).toBe(2);
    expect(errorCounts[sessAIndex]).toBe(1);
    expect(isCrashed[sessAIndex]).toBe(true);
  });
});
