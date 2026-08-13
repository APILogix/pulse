import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BootstrapService } from '../../src/modules/organization/bootstrap/bootstrap.service.js';
import type { EntitlementsService } from '../../src/modules/billing/entitlements/service.js';
import type { UsageService } from '../../src/modules/billing/usage/service.js';

describe('BootstrapService (/api/v1/me/bootstrap)', () => {
  let mockDb: any;
  let mockEntitlements: Partial<EntitlementsService>;
  let mockUsage: Partial<UsageService>;
  let bootstrapService: BootstrapService;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    mockEntitlements = {
      getSubscriptionState: vi.fn(),
      getEffectiveEntitlements: vi.fn(),
    };
    mockUsage = {
      getCurrentUsage: vi.fn(),
    };
    bootstrapService = new BootstrapService(
      mockDb,
      mockEntitlements as EntitlementsService,
      mockUsage as UsageService
    );
  });

  it('returns empty context when user has no organizations', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });

    const context = await bootstrapService.getBootstrapContext({
      id: 'user_1',
      email: 'user@example.com',
      name: 'Test User',
    });

    expect(context.currentOrganizationId).toBeNull();
    expect(context.organizations).toHaveLength(0);
    expect(context.projects).toHaveLength(0);
    expect(context.billing).toBeNull();
    expect(context.quotas.projects.limit).toBe(0);
  });

  it('aggregates organization, projects, billing, features, integrations, quotas, and usage correctly', async () => {
    mockDb.query
      .mockResolvedValueOnce({
        rows: [
          { id: 'org_1', name: 'Acme Corp', slug: 'acme', role: 'owner' },
          { id: 'org_2', name: 'Beta Inc', slug: 'beta', role: 'member' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 'proj_1', name: 'Frontend App', slug: 'frontend-app', status: 'active' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            projects_used: 1,
            members_used: 2,
            environments_used: 1,
            api_keys_used: 3,
            connectors_used: 4,
            alert_rules_used: 5,
            project_alert_rules_used: 2,
            alert_channels_used: 2,
            routing_rules_used: 1,
          },
        ],
      });

    vi.spyOn(mockEntitlements, 'getSubscriptionState').mockResolvedValue({
      subscriptionId: 'sub_123',
      organizationId: 'org_1',
      planId: 'plan_growth',
      planKey: 'growth',
      planTier: 'growth',
      status: 'active',
      currentPeriodStart: new Date('2026-08-01'),
      currentPeriodEnd: new Date('2026-09-01'),
      cancelAtPeriodEnd: false,
    });

    vi.spyOn(mockEntitlements, 'getEffectiveEntitlements').mockResolvedValue({
      'alerting.enabled': { featureKey: 'alerting.enabled', booleanValue: true, integerValue: null, decimalValue: null, stringValue: null },
      'ai.enabled': { featureKey: 'ai.enabled', booleanValue: true, integerValue: null, decimalValue: null, stringValue: null },
      'quota.projects': { featureKey: 'quota.projects', booleanValue: null, integerValue: 25, decimalValue: null, stringValue: null },
      'quota.connectors': { featureKey: 'quota.connectors', booleanValue: null, integerValue: 50, decimalValue: null, stringValue: null },
      'integrations.slack': { featureKey: 'integrations.slack', booleanValue: true, integerValue: null, decimalValue: null, stringValue: null },
      'integrations.discord': { featureKey: 'integrations.discord', booleanValue: true, integerValue: null, decimalValue: null, stringValue: null },
    });

    vi.spyOn(mockUsage, 'getCurrentUsage').mockResolvedValue({
      success: true,
      data: {
        eventsUsed: 150000,
        eventLimit: 500000,
        remainingEvents: 350000,
        aiCreditsUsed: 500,
        aiCreditLimit: 10000,
        remainingAiCredits: 9500,
        projectsUsed: 3,
        membersUsed: 5,
      },
    } as any);

    const context = await bootstrapService.getBootstrapContext(
      {
        id: 'user_1',
        email: 'admin@acme.com',
        name: 'Admin User',
      },
      'org_1'
    );

    expect(context.currentOrganizationId).toBe('org_1');
    expect(context.organizations).toHaveLength(2);
    expect(context.organizations[0].isCurrent).toBe(true);
    expect(context.projects).toHaveLength(1);
    expect(context.billing?.plan?.key).toBe('growth');
    expect(context.billing?.plan?.name).toBe('Growth');
    expect(context.billing?.status).toBe('active');
    expect(context.billing?.cancelAtPeriodEnd).toBe(false);
    expect(context.features.alerting).toBe(true);
    expect(context.features.ai).toBe(true);
    expect(context.integrations.slack).toBe(true);
    expect(context.integrations.discord).toBe(true);
    expect(context.integrations.microsoftTeams).toBe(false);
    expect(context.quotas.projects.limit).toBe(25);
    expect(context.quotas.projects.used).toBe(1);
    expect(context.quotas.projects.remaining).toBe(24);
    expect(context.quotas.connectors.limit).toBe(50);
    expect(context.quotas.connectors.used).toBe(4);
    expect(context.quotas.connectors.remaining).toBe(46);
    expect(context.usage.monthlyEvents.used).toBe(150000);
    expect(context.usage.monthlyEvents.percentage).toBe(30);
    expect(context.usage.aiCredits.used).toBe(500);
    expect(context.usage.aiCredits.percentage).toBe(5);
  });
});

