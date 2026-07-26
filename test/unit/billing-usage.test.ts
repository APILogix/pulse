import { describe, expect, it, vi } from 'vitest';

import { UsageService } from '../../src/modules/billing/usage/service.js';

describe('UsageService', () => {
  it('normalizes pg bigint strings before validating the current usage response', async () => {
    const repository = {
      getCurrentUsage: vi.fn(async () => ({
        organization_id: 'org-1',
        period_start: new Date('2026-07-01T00:00:00.000Z'),
        period_end: new Date('2026-08-01T00:00:00.000Z'),
        events_used: '42',
        event_limit: '5000',
        remaining_events: '4958',
        ai_credits_used: '3',
        ai_credit_limit: '100',
        remaining_ai_credits: '97',
        projects_used: '2',
        members_used: '1',
        api_keys_used: '0',
        connectors_used: '0',
        alert_rules_used: '0',
        dashboards_used: '0',
      })),
      isActiveOrganizationMember: vi.fn(),
    };

    const service = new UsageService(repository as any);

    await expect(service.getCurrentUsage('org-1')).resolves.toEqual({
      success: true,
      data: {
        eventsUsed: 42,
        eventLimit: 5000,
        remainingEvents: 4958,
        aiCreditsUsed: 3,
        aiCreditLimit: 100,
        remainingAiCredits: 97,
        projectsUsed: 2,
        membersUsed: 1,
      },
    });
  });

  it('authorizes requested org headers against active membership', async () => {
    const repository = {
      getCurrentUsage: vi.fn(),
      isActiveOrganizationMember: vi.fn(async () => true),
    };
    const service = new UsageService(repository as any);

    await expect(service.resolveAuthorizedOrgId({ id: 'user-1', currentOrgId: 'org-current' }, 'org-requested'))
      .resolves.toBe('org-requested');
    expect(repository.isActiveOrganizationMember).toHaveBeenCalledWith('org-requested', 'user-1');
  });
});
