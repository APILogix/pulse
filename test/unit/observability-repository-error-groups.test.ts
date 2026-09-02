import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logQuery } = vi.hoisted(() => ({
  logQuery: vi.fn(),
}));

vi.mock('../../src/config/log-database.js', () => ({
  logDB: { queryWithRetry: logQuery },
}));

import { ObservabilityRepository } from '../../src/modules/observability/repository.js';

describe('ObservabilityRepository error group public IDs', () => {
  beforeEach(() => {
    logQuery.mockReset();
  });

  it('resolves latest event IDs by joining error_groups instead of reading a denormalized events_errors column', async () => {
    logQuery.mockResolvedValue({
      rows: [{
        error_group_id: '11111111-1111-4111-8111-111111111111',
        error_group_public_id: 'ISS-000000001',
        public_id: 'ERR-000000001',
      }],
    });

    const result = await new ObservabilityRepository().fetchLatestEventPublicIdMap({
      organizationId: '22222222-2222-4222-8222-222222222222',
      projectId: '33333333-3333-4333-8333-333333333333',
    } as any, ['ISS-000000001']);

    const sql = logQuery.mock.calls[0]![0] as string;
    expect(sql).toContain('FROM events_errors e');
    expect(sql).toContain('LEFT JOIN error_groups eg');
    expect(sql).toContain('eg.public_id AS error_group_public_id');
    expect(sql).toContain('eg.public_id = ANY($2::text[])');
    expect(sql).not.toContain('OR error_group_public_id = ANY');
    expect(result.get('ISS-000000001')).toBe('ERR-000000001');
  });

  it('counts related logs with the strongest single correlation key', async () => {
    logQuery.mockResolvedValue({ rows: [{ count: 3 }] });

    const count = await new ObservabilityRepository().countRelatedLogs(
      {
        organizationId: '22222222-2222-4222-8222-222222222222',
        allowedProjectIds: ['33333333-3333-4333-8333-333333333333'],
      } as any,
      'trace-1',
      'request-1',
      new Date('2026-08-31T00:00:00.000Z'),
      new Date('2026-08-31T00:10:00.000Z'),
    );

    const sql = logQuery.mock.calls[0]![0] as string;
    expect(sql).toContain('FROM events_logs');
    expect(sql).toContain('AND trace_id = $4');
    expect(sql).toContain('project_id = ANY($5)');
    expect(sql).not.toContain(' OR ');
    expect(count).toBe(3);
  });

  it('fetches related errors with a single fallback request key when no trace exists', async () => {
    logQuery.mockResolvedValue({ rows: [{ public_id: 'ERR-000000001', message: 'boom' }] });

    const rows = await new ObservabilityRepository().fetchRelatedErrors(
      {
        organizationId: '22222222-2222-4222-8222-222222222222',
        projectId: '33333333-3333-4333-8333-333333333333',
      } as any,
      null,
      'request-1',
      new Date('2026-08-31T00:00:00.000Z'),
      new Date('2026-08-31T00:10:00.000Z'),
    );

    const sql = logQuery.mock.calls[0]![0] as string;
    expect(sql).toContain('FROM events_errors');
    expect(sql).toContain('AND request_id = $4');
    expect(sql).toContain('project_id = $5');
    expect(sql).not.toContain(' OR ');
    expect(rows).toEqual([{ publicId: 'ERR-000000001', message: 'boom' }]);
  });

  it('fetches a request row by trace public id', async () => {
    logQuery.mockResolvedValue({
      rows: [{
        id: 'request-row-id',
        public_id: 'REQ-000000001',
        request_id: 'request-1',
        trace_id: 'trace-1',
        tracePublicId: 'TRC-000000001',
      }],
    });

    const result = await new ObservabilityRepository().fetchRawById(
      {
        name: 'requests',
        table: 'events_requests',
        timeColumn: 'occurred_at',
        idColumn: 'id',
        fields: {
          publicId: { column: 'public_id', type: 'string', projectable: true },
          requestId: { column: 'request_id', type: 'string', projectable: true },
          traceId: { column: 'trace_id', type: 'string', projectable: true },
          tracePublicId: {
            column: 'trace_public_id',
            selectExpr: '(SELECT t.public_id FROM events_traces t WHERE t.trace_id = events_requests.trace_id LIMIT 1)',
            type: 'string',
            projectable: true,
          },
        },
        defaultProjection: ['publicId', 'requestId', 'traceId', 'tracePublicId'],
        mapRow: (row: Record<string, unknown>) => row,
      } as any,
      {
        organizationId: '22222222-2222-4222-8222-222222222222',
        projectId: '33333333-3333-4333-8333-333333333333',
      } as any,
      'TRC-000000001',
    );

    const sql = logQuery.mock.calls[0]![0] as string;
    expect(sql).toContain('FROM events_requests');
    expect(sql).toContain('trace_id = (');
    expect(sql).toContain('FROM events_traces t');
    expect(sql).toContain('t.public_id = $2');
    expect(sql).toContain('t.organization_id = events_requests.organization_id');
    expect(sql).toContain('t.project_id IS NOT DISTINCT FROM events_requests.project_id');
    expect(sql).toContain('project_id = $3');
    expect(result?.public_id).toBe('REQ-000000001');
  });
});
