import { beforeAll, describe, expect, it, vi } from 'vitest';

let ConnectorSubscriptionRepository: typeof import('../../../src/modules/projects/alerts/subscriptions/connector-subscription.repository.js').ConnectorSubscriptionRepository;

beforeAll(async () => {
  process.env.NODE_ENV = 'development';
  ({ ConnectorSubscriptionRepository } = await import('../../../src/modules/projects/alerts/subscriptions/connector-subscription.repository.js'));
});

describe('ConnectorSubscriptionRepository routing resolver', () => {
  it('scopes subscriptions and active members by organization and excludes inactive connectors', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'project-id', organization_id: 'organization-id' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'subscription-id',
          project_id: 'project-id',
          organization_id: 'organization-id',
          connector_id: 'connector-id',
          enabled: true,
          alert_categories: ['all'],
          severity_threshold: 'warning',
          member_ids: ['user-id'],
          channel_overrides: {},
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ user_id: 'user-id', role: 'developer', email: 'user@example.com' }],
      });
    const repository = new ConnectorSubscriptionRepository({ query } as never);

    const target = await repository.resolveAlertRoutingTargetByProjectId('project-id');

    expect(target).toMatchObject({
      projectId: 'project-id',
      organizationId: 'organization-id',
      apiKeyId: null,
      subscriptions: [{ connectorId: 'connector-id', enabled: true }],
      members: [{ userId: 'user-id' }],
    });

    const projectSql = query.mock.calls[0]![0] as string;
    const subscriptionSql = query.mock.calls[1]![0] as string;
    const memberSql = query.mock.calls[2]![0] as string;
    expect(projectSql).toContain('project.org_id AS organization_id');
    expect(subscriptionSql).toContain('subscription.organization_id = $2');
    expect(subscriptionSql).toContain("connector.status = 'active'");
    expect(memberSql).toContain('member.organization_id = $2');
    expect(query.mock.calls[1]![1]).toEqual(['project-id', 'organization-id']);
    expect(query.mock.calls[2]![1]).toEqual(['project-id', 'organization-id']);
  });
});