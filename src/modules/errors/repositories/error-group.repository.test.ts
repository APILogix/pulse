import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { ErrorGroupRepository } from './error-group.repository.js';

const projectId = '22222222-2222-4222-8222-222222222222';
const organizationId = '11111111-1111-4111-8111-111111111111';

function item(overrides: Record<string, unknown> = {}) {
  return {
    inputIndex: 0,
    organizationId,
    projectId,
    fingerprint: 'fingerprint-1',
    fingerprintVersion: 2,
    eventId: 'evt-1',
    severity: 'error',
    message: 'boom',
    errorName: 'Error',
    occurredAt: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  };
}

function groupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    organization_id: organizationId,
    project_id: projectId,
    fingerprint: 'fingerprint-1',
    status: 'OPEN',
    occurrence_count: 1,
    first_seen_at: new Date('2026-08-23T00:00:00.000Z'),
    last_seen_at: new Date('2026-08-23T00:00:00.000Z'),
    latest_event_occurred_at: new Date('2026-08-23T00:00:00.000Z'),
    latest_event_id: 'evt-0',
    highest_severity: 'warning',
    latest_severity: 'warning',
    regression_count: 0,
    resolved_at: null,
    resolved_release: null,
    merged_into: null,
    created_at: new Date('2026-08-23T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ErrorGroupRepository', () => {
  it('upserts normal error groups in set-based statements', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values: values ?? [] });
        if (sql.includes('FOR UPDATE OF g')) return { rows: [groupRow()] };
        if (sql.startsWith('UPDATE error_groups AS g')) return { rows: [], rowCount: 1 };
        if (sql.includes('SELECT g.*')) return { rows: [groupRow({ occurrence_count: 3 })] };
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;

    const repository = new ErrorGroupRepository({} as Pool);
    const result = await repository.upsertGroupsBatch(client, [
      item({ inputIndex: 0, eventId: 'evt-1', severity: 'warning' }),
      item({ inputIndex: 1, eventId: 'evt-2', severity: 'fatal', occurredAt: new Date('2026-08-24T00:00:01.000Z') }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((row) => row.result.id)).toEqual([
      '33333333-3333-4333-8333-333333333333',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(client.query).toHaveBeenCalledTimes(3);
    expect(queries[0]?.sql).toContain('FOR UPDATE OF g');
    expect(queries[1]?.sql).toContain('UPDATE error_groups AS g');
    expect(queries[1]?.sql).toContain('occurrence_count = g.occurrence_count + v.occurrence_delta');
    expect(queries[1]?.sql).toContain('$1::uuid');
    expect(queries[1]?.sql).toContain('$22::bigint');
    expect(queries[2]?.sql).toContain('SELECT g.*');
  });

  it('records created history only for groups inserted by the batch', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values: values ?? [] });
        if (sql.includes('FOR UPDATE OF g')) return { rows: [] };
        if (sql.includes('INSERT INTO error_groups')) {
          return { rows: [{ project_id: projectId, fingerprint: 'fingerprint-1', inserted: true }], rowCount: 1 };
        }
        if (sql.includes('SELECT g.*')) return { rows: [groupRow({ occurrence_count: 2 })] };
        if (sql.includes('INSERT INTO error_group_history')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;

    const repository = new ErrorGroupRepository({} as Pool);
    const result = await repository.upsertGroupsBatch(client, [item()]);

    expect(result[0]?.result.isNew).toBe(true);
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(queries[1]?.sql).toContain('ON CONFLICT (project_id, fingerprint) DO NOTHING');
    expect(queries[1]?.sql).toContain('RETURNING project_id, fingerprint');
    expect(queries[3]?.sql).toContain('INSERT INTO error_group_history');
    expect(queries[3]?.values).toContain('CREATED');
  });

  it('locks conflict-created groups and updates them through the existing-group path', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values: values ?? [] });
        if (sql.includes('FOR UPDATE OF g') && queries.length === 1) return { rows: [] };
        if (sql.includes('INSERT INTO error_groups')) return { rows: [], rowCount: 0 };
        if (sql.includes('FOR UPDATE OF g')) return { rows: [groupRow()] };
        if (sql.startsWith('UPDATE error_groups AS g')) return { rows: [], rowCount: 1 };
        if (sql.includes('SELECT g.*')) return { rows: [groupRow({ occurrence_count: 2 })] };
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;

    const repository = new ErrorGroupRepository({} as Pool);
    const result = await repository.upsertGroupsBatch(client, [item()]);

    expect(result[0]?.result.isNew).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(5);
    expect(queries[1]?.sql).toContain('ON CONFLICT (project_id, fingerprint) DO NOTHING');
    expect(queries[2]?.sql).toContain('FOR UPDATE OF g');
    expect(queries[3]?.sql).toContain('UPDATE error_groups AS g');
  });

  it('records regression history and outbox for the first qualifying event in batch order', async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values: values ?? [] });
        if (sql.includes('FOR UPDATE OF g')) {
          return {
            rows: [
              groupRow({
                status: 'RESOLVED',
                resolved_at: new Date('2026-08-23T12:00:00.000Z'),
                resolved_release: '1.0.0',
                regression_count: 2,
              }),
            ],
          };
        }
        if (sql.startsWith('UPDATE error_groups AS g')) return { rows: [], rowCount: 1 };
        if (sql.includes('SELECT g.*')) {
          return {
            rows: [
              groupRow({
                status: 'OPEN',
                is_regression: true,
                regression_count: 3,
              }),
            ],
          };
        }
        if (sql.includes('INSERT INTO error_group_history')) return { rows: [], rowCount: 1 };
        if (sql.includes('INSERT INTO telemetry_outbox')) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;

    const repository = new ErrorGroupRepository({} as Pool);
    const result = await repository.upsertGroupsBatch(client, [
      item({
        inputIndex: 0,
        eventId: 'evt-newer',
        release: '1.2.0',
        occurredAt: new Date('2026-08-24T00:00:02.000Z'),
      }),
      item({
        inputIndex: 1,
        eventId: 'evt-newest',
        release: '1.3.0',
        occurredAt: new Date('2026-08-24T00:00:03.000Z'),
      }),
    ]);

    expect(result.map((row) => row.result.isRegression)).toEqual([true, false]);
    expect(client.query).toHaveBeenCalledTimes(5);
    expect(queries[1]?.sql).toContain('UPDATE error_groups AS g');
    expect(queries[3]?.sql).toContain('INSERT INTO error_group_history');
    expect(queries[3]?.values).toContain('REGRESSED');
    expect(queries[3]?.values).toContain('evt-newer');
    expect(queries[4]?.sql).toContain('INSERT INTO telemetry_outbox');
    expect(queries[4]?.values).toContain('error_group_regressed:33333333-3333-4333-8333-333333333333:evt-newer');
  });

  it('falls back before mutation when merged groups require redirect resolution', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FOR UPDATE OF g')) {
          return { rows: [groupRow({ merged_into: '44444444-4444-4444-8444-444444444444' })] };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PoolClient;

    const repository = new ErrorGroupRepository({} as Pool);

    await expect(repository.upsertGroupsBatch(client, [item()])).rejects.toThrow(
      'BULK_ERROR_GROUP_MERGED_GROUP_FALLBACK_REQUIRED',
    );
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
