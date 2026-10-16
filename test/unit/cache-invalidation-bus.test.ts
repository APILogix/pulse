import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initInvalidationBus,
  publishInvalidation,
  registerL1Cache,
  resetInvalidationBusForTest,
} from '../../src/shared/cache/invalidation-bus.js';
import { apiKeyCache } from '../../src/config/lrucashe.js';
import { membershipCache, invalidateMembershipCache } from '../../src/shared/middleware/tenant.js';
import { flagCache } from '../../src/modules/feature-flags/service.js';
import { entitlementsService } from '../../src/modules/billing/entitlements/service.js';
import { AlertRuntimeRuleCatalog } from '../../src/modules/alerting/runtime/rule-catalog.js';

describe('Tier 0.3: Distributed Cache Invalidation Bus', () => {
  beforeEach(() => {
    resetInvalidationBusForTest();
    vi.restoreAllMocks();
  });

  it('Eviction published on Worker A removes cached item on Worker B within 100ms', async () => {
    // Simulate Worker B: populate local L1 caches
    apiKeyCache.set('test_key_hash_1', { id: 'proj_1' } as any);
    membershipCache.set('org_1:user_1', true);
    flagCache.set('flag_beta:org_1:none:on', { enabled: true, source: 'rule' });

    expect(apiKeyCache.has('test_key_hash_1')).toBe(true);
    expect(membershipCache.has('org_1:user_1')).toBe(true);

    // Initialize subscriber on Worker B
    let messageHandler: ((channel: string, message: string) => void) | null = null;
    const fakeSubscriber = {
      subscribe: vi.fn().mockResolvedValue('OK'),
      on: vi.fn().mockImplementation((event: string, cb: any) => {
        if (event === 'message') messageHandler = cb;
      }),
      removeAllListeners: vi.fn(),
    };

    initInvalidationBus({ subscriber: fakeSubscriber as any });

    // Worker A publishes eviction of test_key_hash_1
    const publishPayload = {
      cache: 'apiKey',
      key: 'test_key_hash_1',
      ts: Date.now(),
    };

    // Simulate Redis Pub/Sub delivery to Worker B within 100ms
    const start = Date.now();
    expect(messageHandler).not.toBeNull();
    messageHandler!('pulse:cache:invalidation', JSON.stringify(publishPayload));

    expect(Date.now() - start).toBeLessThan(100);
    expect(apiKeyCache.has('test_key_hash_1')).toBe(false);
  });

  it('Subscriber reconnect event triggers full flush of all L1 caches', async () => {
    // Populate L1 caches on Worker
    apiKeyCache.set('key_to_flush', { id: 'p1' } as any);
    membershipCache.set('org_to_flush:u1', true);

    let reconnectHandler: (() => void) | null = null;
    const fakeSubscriber = {
      subscribe: vi.fn().mockResolvedValue('OK'),
      on: vi.fn().mockImplementation((event: string, cb: any) => {
        if (event === 'reconnecting' || event === 'connect') {
          reconnectHandler = cb;
        }
      }),
      removeAllListeners: vi.fn(),
    };

    initInvalidationBus({ subscriber: fakeSubscriber as any });

    expect(apiKeyCache.has('key_to_flush')).toBe(true);
    expect(membershipCache.has('org_to_flush:u1')).toBe(true);

    // Simulate network reconnect event
    expect(reconnectHandler).not.toBeNull();
    reconnectHandler!();

    // Verify all L1 caches are completely cleared
    expect(apiKeyCache.size).toBe(0);
    expect(membershipCache.size).toBe(0);
  });

  it('Revocation-critical cache apiKeyCache has TTL <= 60s and updateAgeOnGet = false', () => {
    // Inspect apiKeyCache options
    const ttl = (apiKeyCache as any).ttl;
    const updateAgeOnGet = (apiKeyCache as any).updateAgeOnGet;

    expect(ttl).toBeLessThanOrEqual(60_000);
    expect(updateAgeOnGet).toBe(false);
  });

  it('Tenant and Flag mutation helpers trigger invalidation bus publish', async () => {
    const published: any[] = [];
    const fakePublisher = {
      publish: vi.fn().mockImplementation(async (channel: string, msg: string) => {
        published.push(JSON.parse(msg));
        return 1;
      }),
    };

    initInvalidationBus({ publisher: fakePublisher as any });

    // Mutate membership
    invalidateMembershipCache('org_mut_1', 'user_mut_1');
    expect(published.some((p) => p.cache === 'membership' && p.key === 'org_mut_1:user_mut_1')).toBe(true);

    // Mutate flag
    flagCache.invalidate('test_flag_mut');
    expect(published.some((p) => p.cache === 'flag' && p.key === 'test_flag_mut')).toBe(true);

    // Mutate entitlements
    entitlementsService.invalidateOrgCache('org_ent_1');
    expect(published.some((p) => p.cache === 'entitlements' && p.key === 'org_ent_1')).toBe(true);

    // Mutate alert rule catalog
    AlertRuntimeRuleCatalog.invalidateGlobal('org_alert_1', 'fast');
    expect(published.some((p) => p.cache === 'ruleCatalog' && p.key === 'org_alert_1:fast')).toBe(true);
  });
});
