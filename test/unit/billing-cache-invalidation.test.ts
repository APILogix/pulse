import { describe, it, expect, vi, beforeEach } from 'vitest';
import { entitlementsService } from '../../src/modules/billing/entitlements/service.js';
import { IngestionService } from '../../src/modules/ingestion/service.js';
import { SubscriptionsService } from '../../src/modules/billing/subscriptions/service.js';
import { AddonsService } from '../../src/modules/billing/addons/service.js';

describe('Central Billing Cache Invalidation Bus', () => {
  const orgId = 'org-cache-test-123';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies registered listeners when organization cache is invalidated', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    const unsubscribeA = entitlementsService.onOrgInvalidate(listenerA);
    const unsubscribeB = entitlementsService.onOrgInvalidate(listenerB);

    entitlementsService.invalidateOrgCache(orgId);

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerA).toHaveBeenCalledWith(orgId);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledWith(orgId);

    unsubscribeA();
    entitlementsService.invalidateOrgCache(orgId);

    expect(listenerA).toHaveBeenCalledTimes(1); // not called again
    expect(listenerB).toHaveBeenCalledTimes(2);

    unsubscribeB();
  });

  it('invalidates IngestionService quota cache when entitlementsService.invalidateOrgCache is called', () => {
    const mockPool = {} as any;
    const mockWriter = {} as any;
    const ingestion = new IngestionService(mockPool, mockWriter, {
      maxBatchSize: 100,
      defaultRateLimitPerSecond: 100,
      defaultRateLimitPerMinute: 6000,
    });

    const invalidateSpy = vi.spyOn(ingestion, 'invalidateOrgQuotaCache');

    entitlementsService.invalidateOrgCache(orgId);

    expect(invalidateSpy).toHaveBeenCalledWith(orgId);
  });

  it('triggers central cache invalidation upon subscription plan change', async () => {
    const mockSubRepo = {
      withTransaction: vi.fn().mockImplementation(async (cb: any) => {
        return cb({});
      }),
      getSubscriptionForUpdate: vi.fn().mockResolvedValue({
        id: 'sub-1',
        organization_id: orgId,
        plan_id: 'plan-free',
        billing_interval: 'monthly',
        metadata: {},
      }),
      getPlanUsageLimitSnapshot: vi.fn().mockResolvedValue({
        modules: {},
        entitlements: {},
        eventLimit: 50000,
        aiCreditLimit: 100,
      }),
      updateSubscription: vi.fn().mockResolvedValue({ id: 'sub-1', plan_id: 'plan-growth' }),
      upsertUsageCurrentPeriod: vi.fn().mockResolvedValue(undefined),
      logEvent: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockPlansRepo = {
      getPlanById: vi.fn().mockResolvedValue({
        id: 'plan-growth',
        name: 'Growth',
        tier: 'growth',
        sort_order: 3,
      }),
    } as any;

    const invalidateSpy = vi.spyOn(entitlementsService, 'invalidateOrgCache');

    const subService = new SubscriptionsService(mockSubRepo, mockPlansRepo);
    await subService.changePlan(orgId, 'plan-growth', 'admin-user');

    expect(invalidateSpy).toHaveBeenCalledWith(orgId);
  });

  it('triggers central cache invalidation upon add-on subscription', async () => {
    const mockAddonsRepo = {
      withTransaction: vi.fn().mockImplementation(async (cb: any) => cb({})),
      getActiveSubscription: vi.fn().mockResolvedValue({ id: 'sub-1' }),
      getAddonForUpdate: vi.fn().mockResolvedValue({ id: 'addon-1', target_feature_id: 'feat-1' }),
      subscribeAddon: vi.fn().mockResolvedValue({ id: 'sub-addon-1', addon_id: 'addon-1' }),
    } as any;

    const invalidateSpy = vi.spyOn(entitlementsService, 'invalidateOrgCache');

    const addonsService = new AddonsService(mockAddonsRepo);
    await addonsService.subscribeAddon(orgId, { addonId: 'addon-1', quantity: 1 });

    expect(invalidateSpy).toHaveBeenCalledWith(orgId);
  });
});
