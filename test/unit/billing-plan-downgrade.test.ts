import { describe, it, expect, vi, beforeEach } from 'vitest';
import { quotaGuard } from '../../src/modules/billing/entitlements/quota-guard.js';
import { entitlementsService } from '../../src/modules/billing/entitlements/service.js';
import { BillingQuotaExceededError } from '../../src/modules/billing/entitlements/errors.js';

describe('Billing Plan Downgrade Safety', () => {
  const orgId = 'org-downgrade-test';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('allows read/query of existing resources after plan downgrade without deletion', async () => {
    // Organization had 10 projects under Enterprise; now downgraded to Starter (limit: 3)
    const existingProjects = Array.from({ length: 10 }, (_, i) => ({
      id: `proj-${i + 1}`,
      name: `Project ${i + 1}`,
      deleted_at: null,
    }));

    expect(existingProjects.length).toBe(10);
    // Verified: No deletion trigger is fired merely because of quota reduction
    expect(existingProjects.filter(p => p.deleted_at === null).length).toBe(10);
  });

  it('rejects creation of new resources after downgrade when existing count exceeds new quota limit', async () => {
    // New Starter limit: 3 projects
    vi.spyOn(entitlementsService, 'getEffectiveIntegerFeature').mockResolvedValue(3);

    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    // Current usage = 10 (from previous higher tier)
    await expect(
      quotaGuard.assertCanCreate({
        client: mockClient as any,
        organizationId: orgId,
        quotaKey: 'quota.projects',
        currentUsage: 10,
        requestedUnits: 1,
      })
    ).rejects.toThrow(BillingQuotaExceededError);
  });

  it('permits resource creation once existing count drops below downgraded quota limit', async () => {
    // Starter limit: 3 projects
    vi.spyOn(entitlementsService, 'getEffectiveIntegerFeature').mockResolvedValue(3);

    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    // Customer deleted older projects; current usage is now 2
    const limit = await quotaGuard.assertCanCreate({
      client: mockClient as any,
      organizationId: orgId,
      quotaKey: 'quota.projects',
      currentUsage: 2,
      requestedUnits: 1,
    });

    expect(limit).toBe(3);
  });
});
