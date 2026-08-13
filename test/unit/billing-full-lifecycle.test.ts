import { describe, it, expect, vi, beforeEach } from 'vitest';
import { entitlementsService } from '../../src/modules/billing/entitlements/service.js';
import { quotaGuard } from '../../src/modules/billing/entitlements/quota-guard.js';
import { UsageService } from '../../src/modules/billing/usage/service.js';
import { BillingQuotaExceededError } from '../../src/modules/billing/entitlements/errors.js';

describe('Full End-to-End Billing Lifecycle Control Plane', () => {
  const orgId = 'org-full-lifecycle-123';

  beforeEach(() => {
    vi.restoreAllMocks();
    entitlementsService.clearCache();
  });

  it('orchestrates complete lifecycle: provision -> bootstrap -> quota enforce -> upgrade -> invalidation -> proceed', async () => {
    // 1. Initial State: Free Tier (Limit: 2 projects)
    let currentPlanLimit = 2;
    vi.spyOn(entitlementsService, 'getEffectiveIntegerFeature').mockImplementation(async (_org, key) => {
      if (key === 'quota.projects') return currentPlanLimit;
      if (key === 'quota.members') return 5;
      if (key === 'quota.monthly_events') return 50000;
      if (key === 'quota.ai_credits') return 100;
      return -1;
    });

    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
        return { rows: [] };
      }),
    };

    // 2. Organization creates 1st project (Current: 0, requested: 1 <= 2) -> Allowed
    const limit1 = await quotaGuard.assertCanCreate({
      client: mockClient as any,
      organizationId: orgId,
      quotaKey: 'quota.projects',
      currentUsage: 0,
      requestedUnits: 1,
    });
    expect(limit1).toBe(2);

    // 3. Organization creates 2nd project (Current: 1, requested: 1 <= 2) -> Allowed
    const limit2 = await quotaGuard.assertCanCreate({
      client: mockClient as any,
      organizationId: orgId,
      quotaKey: 'quota.projects',
      currentUsage: 1,
      requestedUnits: 1,
    });
    expect(limit2).toBe(2);

    // 4. Organization attempts 3rd project (Current: 2, requested: 1 > 2) -> Quota Exceeded
    await expect(
      quotaGuard.assertCanCreate({
        client: mockClient as any,
        organizationId: orgId,
        quotaKey: 'quota.projects',
        currentUsage: 2,
        requestedUnits: 1,
      })
    ).rejects.toThrow(BillingQuotaExceededError);

    // 5. Organization upgrades to Growth Plan (Limit: 25 projects)
    currentPlanLimit = 25;
    // Central cache invalidation event fires
    entitlementsService.invalidateOrgCache(orgId);

    // 6. Organization re-attempts 3rd project creation -> Succeeded under new limit!
    const limit3 = await quotaGuard.assertCanCreate({
      client: mockClient as any,
      organizationId: orgId,
      quotaKey: 'quota.projects',
      currentUsage: 2,
      requestedUnits: 1,
    });
    expect(limit3).toBe(25);
  });
});
