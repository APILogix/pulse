import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('../../../src/config/database.js', () => ({
  pool: {
    query,
  },
}));

async function createRepository() {
  const { ConnectorRoutesRepository } = await import('../../../src/modules/connectors/routing/routes.repository.js');
  return new ConnectorRoutesRepository();
}

describe('ConnectorRoutesRepository project isolation', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('rejects routes that reference a project outside the organization', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const repository = await createRepository();

    await expect(repository.createRoute('org-1', 'connector-1', {
      projectId: 'project-other-org',
      environment: 'production',
      eventType: 'incident.created',
      severity: 'critical',
      enabled: true,
    })).rejects.toMatchObject({
      code: 'CONNECTOR_NOT_FOUND',
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![0]).toContain('FROM connector_configs');
    expect(query.mock.calls[1]![0]).toContain('FROM projects');
    expect(query.mock.calls[1]![1]).toEqual(['project-other-org', 'org-1']);
  });

  it('validates project ownership before updating a route project filter', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'route-1',
          connector_id: 'connector-1',
          project_id: 'project-1',
          environment: 'production',
          event_type: 'incident.created',
          severity: 'critical',
          enabled: true,
          created_at: new Date('2026-07-14T12:00:00.000Z'),
        }],
      });

    const repository = await createRepository();

    const row = await repository.updateRoute('org-1', 'connector-1', 'route-1', {
      projectId: 'project-1',
      enabled: true,
    });

    expect(row?.project_id).toBe('project-1');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1]![0]).toContain('FROM projects');
    expect(query.mock.calls[2]![0]).toContain('UPDATE connector_routes');
  });
});
