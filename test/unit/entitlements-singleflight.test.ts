import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntitlementsService } from '../../src/modules/billing/entitlements/service.js';

describe('Tier 2.1: Entitlements Single-Flight / Promise Coalescing', () => {
  let service: EntitlementsService;
  let mockRepository: any;

  const orgId = 'org_single_flight_123';

  beforeEach(() => {
    mockRepository = {
      getEffectiveEntitlements: vi.fn().mockImplementation(async () => {
        // Simulate database query latency
        await new Promise((resolve) => setTimeout(resolve, 30));
        return [
          { feature_key: 'custom_domains', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
          { feature_key: 'max_projects', boolean_value: null, integer_value: 10, decimal_value: null, string_value: null },
        ];
      }),
      getSubscriptionState: vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          subscriptionId: 'sub_123',
          planId: 'plan_pro',
          planKey: 'pro',
          planTier: 'growth',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
        };
      }),
    };

    service = new EntitlementsService(mockRepository);
  });

  it('10 concurrent requests for the same org hit Postgres exactly once', async () => {
    const start = performance.now();

    // Fire 10 concurrent requests while cache is cold
    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.getEffectiveEntitlements(orgId)),
    );

    const duration = performance.now() - start;

    // All 10 callers receive the same resolved entitlements
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r['custom_domains'].booleanValue).toBe(true);
      expect(r['max_projects'].integerValue).toBe(10);
    }

    // CRITICAL: Postgres repository MUST be called exactly ONCE due to single-flight coalescing
    expect(mockRepository.getEffectiveEntitlements).toHaveBeenCalledTimes(1);
    expect(mockRepository.getSubscriptionState).toHaveBeenCalledTimes(1);

    // Latency should be ~1 DB query duration (~30-50ms), NOT 10 serial queries
    expect(duration).toBeLessThan(100);
  });
});
