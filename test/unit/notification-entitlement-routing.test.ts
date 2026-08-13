import { describe, expect, it, vi } from 'vitest';
import { NotificationEntitlementService } from '../../src/modules/alerting/runtime/notification-entitlement.service.js';
import { ProjectOwnerRepository } from '../../src/modules/alerting/runtime/email-only-restricted-routing.js';

function row(feature_key: string, value: boolean | number | string) {
  return {
    organization_id: 'org-1',
    feature_key,
    boolean_value: typeof value === 'boolean' ? value : null,
    integer_value: typeof value === 'number' ? value : null,
    decimal_value: null,
    string_value: typeof value === 'string' ? value : null,
  };
}

describe('NotificationEntitlementService', () => {
  it('returns normal connector mode from live alerting and integration entitlements', async () => {
    const service = new NotificationEntitlementService({
      getEffectiveEntitlements: vi.fn().mockResolvedValue([
        row('alerting.enabled', true),
        row('integrations.slack', true),
        row('quota.integrations', 10),
      ]),
    });

    const decision = await service.resolve('org-1');

    expect(decision).toMatchObject({
      mode: 'NORMAL_CONNECTOR',
      connectorAccess: true,
      reason: 'CONNECTOR_ACCESS_ALLOWED',
    });
    expect(decision.isProviderAllowed('slack', true)).toBe(true);
    expect(decision.isProviderAllowed('discord', true)).toBe(false);
    expect(decision.isProviderAllowed('email', false)).toBe(true);
  });

  it('returns owner-only restricted mode when connector entitlement is absent', async () => {
    const service = new NotificationEntitlementService({
      getEffectiveEntitlements: vi.fn().mockResolvedValue([
        row('alerting.enabled', false),
        row('quota.integrations', 0),
      ]),
    });

    const decision = await service.resolve('org-1');

    expect(decision).toMatchObject({
      mode: 'EMAIL_ONLY_RESTRICTED',
      connectorAccess: false,
      reason: 'CONNECTOR_ENTITLEMENT_REQUIRED',
    });
    expect(decision.isProviderAllowed('slack', true)).toBe(false);
  });

  it('returns normal connector mode for enterprise plan with seeded database keys', async () => {
    const service = new NotificationEntitlementService({
      getEffectiveEntitlements: vi.fn().mockResolvedValue([
        row('connectors', -1),
        row('alert_rules', -1),
        row('in_app_alerts', true),
        row('email_alerts', true),
        row('slack_connector', true),
        row('discord_connector', true),
        row('teams_connector', true),
        row('webhook_connector', true),
      ]),
    });

    const decision = await service.resolve('org-enterprise');

    expect(decision).toMatchObject({
      mode: 'NORMAL_CONNECTOR',
      connectorAccess: true,
      reason: 'CONNECTOR_ACCESS_ALLOWED',
    });
    expect(decision.isProviderAllowed('slack', true)).toBe(true);
    expect(decision.isProviderAllowed('discord', true)).toBe(true);
    expect(decision.isProviderAllowed('teams', true)).toBe(true);
    expect(decision.isProviderAllowed('webhook', true)).toBe(true);
    expect(decision.isProviderAllowed('email', false)).toBe(true);
  });

  it('returns owner-only restricted mode for free plan with seeded database keys', async () => {
    const service = new NotificationEntitlementService({
      getEffectiveEntitlements: vi.fn().mockResolvedValue([
        row('connectors', 0),
        row('alert_rules', 1),
        row('in_app_alerts', true),
        row('email_alerts', false),
        row('slack_connector', false),
        row('discord_connector', false),
        row('teams_connector', false),
        row('webhook_connector', false),
      ]),
    });

    const decision = await service.resolve('org-free');

    expect(decision).toMatchObject({
      mode: 'EMAIL_ONLY_RESTRICTED',
      connectorAccess: false,
      reason: 'CONNECTOR_ENTITLEMENT_REQUIRED',
    });
    expect(decision.isProviderAllowed('slack', true)).toBe(false);
    expect(decision.isProviderAllowed('webhook', true)).toBe(false);
  });

  it('fails closed when billing cannot be read', async () => {
    const service = new NotificationEntitlementService({
      getEffectiveEntitlements: vi.fn().mockRejectedValue(new Error('billing unavailable')),
    });

    await expect(service.resolve('org-1')).resolves.toMatchObject({
      mode: 'EMAIL_ONLY_RESTRICTED',
      connectorAccess: false,
      reason: 'ENTITLEMENT_UNKNOWN',
    });
  });
});

describe('ProjectOwnerRepository', () => {
  it('scopes owner resolution by organization and project and verifies the user email', async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [{ user_id: 'owner-1', email: 'owner@example.test' }],
      }),
    };
    const repository = new ProjectOwnerRepository(db as never);

    await expect(repository.findActiveVerifiedOwner('org-1', 'project-1')).resolves.toEqual({
      userId: 'owner-1',
      email: 'owner@example.test',
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('member.organization_id = $1'),
      ['org-1', 'project-1'],
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("member.project_id = $2"),
      ['org-1', 'project-1'],
    );
  });
});
