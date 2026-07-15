import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('../../../src/config/database.js', () => ({
  pool: {
    query,
  },
}));

async function createRepository() {
  const { ConnectorAuditRepository } = await import('../../../src/modules/connectors/audit/audit.repository.js');
  return new ConnectorAuditRepository();
}

describe('ConnectorAuditRepository', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('persists actor type with audit rows', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const repository = await createRepository();

    await repository.insertAuditLog({
      organizationId: 'org-1',
      connectorId: 'connector-1',
      action: 'created',
      actorId: 'user-1',
      actorType: 'user',
      changesSummary: { name: 'Production Slack' },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      requestId: 'request-1',
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain('actor_type');
    expect(query.mock.calls[0]![0]).toContain('VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)');
    expect(query.mock.calls[0]![1]).toEqual([
      'org-1',
      'connector-1',
      'created',
      'user-1',
      'user',
      null,
      null,
      JSON.stringify({ name: 'Production Slack' }),
      '127.0.0.1',
      'vitest',
      'request-1',
    ]);
  });

  it('selects actor type when listing audit rows', async () => {
    const createdAt = new Date('2026-07-14T12:00:00.000Z');
    query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'audit-1',
          organization_id: 'org-1',
          connector_id: 'connector-1',
          action: 'created',
          actor_id: 'user-1',
          actor_type: 'user',
          previous_state: null,
          new_state: null,
          changes_summary: { name: 'Production Slack' },
          ip_address: '127.0.0.1',
          user_agent: 'vitest',
          request_id: 'request-1',
          created_at: createdAt,
        }],
      });

    const repository = await createRepository();

    const result = await repository.listAuditLogs('org-1', 'connector-1', { limit: 10, offset: 0 });

    expect(result.data[0]?.actor_type).toBe('user');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]![0]).toContain('actor_type');
    expect(query.mock.calls[1]![1]).toEqual(['org-1', 'connector-1', 10, 0]);
  });

  it('defaults direct system audit writes to a system actor type', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const repository = await createRepository();

    await repository.insertAuditLog({
      organizationId: 'org-1',
      connectorId: 'connector-1',
      action: 'delivery.sent',
      actorId: null,
    });

    expect(query.mock.calls[0]![1][4]).toBe('system');
  });
});
