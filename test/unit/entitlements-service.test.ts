import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EntitlementsService } from '../../src/modules/billing/entitlements/service.js';
import { QuotaGuard } from '../../src/modules/billing/entitlements/quota-guard.js';
import {
  BillingFeatureDisabledError,
  BillingQuotaExceededError,
} from '../../src/modules/billing/entitlements/errors.js';
import {
  buildEffectiveEntitlementsSql,
  EntitlementsRepository,
  type EffectiveEntitlementRow,
} from '../../src/modules/billing/entitlements/repository.js';

describe('EntitlementsRepository query optimization (BIL-Q011)', () => {
  it('builds SQL with feature predicate pushdown for single and array feature lookups', () => {
    const singleSql = buildEffectiveEntitlementsSql({ paramIndex: 2 });
    expect(singleSql).toContain('AND bf.feature_key = $2');

    const arraySql = buildEffectiveEntitlementsSql({ paramIndex: 2, isArray: true });
    expect(arraySql).toContain('AND bf.feature_key = ANY($2::text[])');

    const fullSql = buildEffectiveEntitlementsSql();
    expect(fullSql).not.toContain('AND bf.feature_key =');
  });

  it('resolves multiple features in a single getFeaturesMap call', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { organization_id: 'org-123', feature_key: 'alerting.enabled', boolean_value: true },
          { organization_id: 'org-123', feature_key: 'quota.connectors', integer_value: 10 },
        ],
      }),
    };

    const repo = new EntitlementsRepository(mockDb as any);
    const map = await repo.getFeaturesMap('org-123', ['alerting.enabled', 'quota.connectors']);

    expect(mockDb.query).toHaveBeenCalledTimes(1);
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('AND bf.feature_key = ANY($2::text[])'),
      ['org-123', ['alerting.enabled', 'quota.connectors']]
    );
    expect(map.get('alerting.enabled')?.boolean_value).toBe(true);
    expect(map.get('quota.connectors')?.integer_value).toBe(10);
  });
});

describe('EntitlementsService & QuotaGuard', () => {
  let mockRepo: EntitlementsRepository;
  let service: EntitlementsService;
  let guard: QuotaGuard;

  const mockRows: EffectiveEntitlementRow[] = [
    {
      organization_id: 'org-123',
      feature_key: 'quota.projects',
      boolean_value: null,
      integer_value: 5,
      decimal_value: null,
      string_value: null,
    },
    {
      organization_id: 'org-123',
      feature_key: 'quota.monthly_events',
      boolean_value: null,
      integer_value: 1_000_000,
      decimal_value: null,
      string_value: null,
    },
    {
      organization_id: 'org-123',
      feature_key: 'alerting.enabled',
      boolean_value: true,
      integer_value: null,
      decimal_value: null,
      string_value: null,
    },
    {
      organization_id: 'org-123',
      feature_key: 'integrations.slack',
      boolean_value: true,
      integer_value: null,
      decimal_value: null,
      string_value: null,
    },
    {
      organization_id: 'org-123',
      feature_key: 'security.sso',
      boolean_value: false,
      integer_value: null,
      decimal_value: null,
      string_value: null,
    },
    {
      organization_id: 'org-123',
      feature_key: 'quota.unlimited_feature',
      boolean_value: null,
      integer_value: -1,
      decimal_value: null,
      string_value: null,
    },
  ];

  beforeEach(() => {
    mockRepo = {
      getEffectiveEntitlements: vi.fn().mockResolvedValue(mockRows),
      getSubscriptionState: vi.fn().mockResolvedValue({
        subscriptionId: 'sub-123',
        planId: 'plan-starter',
        planKey: 'starter',
        planTier: 'starter',
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        cancelAtPeriodEnd: false,
      }),
      hasFeature: vi.fn(),
      getEffectiveFeatureRow: vi.fn(),
    } as unknown as EntitlementsRepository;

    service = new EntitlementsService(mockRepo, { ttlMs: 1000 });
    guard = new QuotaGuard(service);
  });

  describe('Feature Lookups & Fail-Closed Semantics', () => {
    it('returns true for enabled boolean feature', async () => {
      const enabled = await service.getEffectiveBooleanFeature('org-123', 'alerting.enabled');
      expect(enabled).toBe(true);
    });

    it('returns false for disabled boolean feature', async () => {
      const enabled = await service.getEffectiveBooleanFeature('org-123', 'security.sso');
      expect(enabled).toBe(false);
    });

    it('fails closed (returns false) for unknown or missing feature', async () => {
      const enabled = await service.getEffectiveBooleanFeature('org-123', 'unknown.feature');
      expect(enabled).toBe(false);
    });

    it('returns correct integer quota limit', async () => {
      const limit = await service.getEffectiveIntegerFeature('org-123', 'quota.projects');
      expect(limit).toBe(5);
    });

    it('fails closed (returns 0) for missing integer quota', async () => {
      const limit = await service.getEffectiveIntegerFeature('org-123', 'quota.nonexistent');
      expect(limit).toBe(0);
    });

    it('returns -1 for explicit unlimited quota', async () => {
      const limit = await service.getEffectiveIntegerFeature('org-123', 'quota.unlimited_feature');
      expect(limit).toBe(-1);
    });
  });

  describe('Assertions', () => {
    it('assertFeatureEnabled succeeds when feature is active', async () => {
      await expect(service.assertFeatureEnabled('org-123', 'alerting.enabled')).resolves.not.toThrow();
    });

    it('assertFeatureEnabled throws BillingFeatureDisabledError when disabled', async () => {
      await expect(service.assertFeatureEnabled('org-123', 'security.sso')).rejects.toThrow(
        BillingFeatureDisabledError
      );
    });

    it('assertQuota succeeds when usage is within limits', async () => {
      const limit = await service.assertQuota('org-123', 'quota.projects', 3, 1);
      expect(limit).toBe(5);
    });

    it('assertQuota throws BillingQuotaExceededError when limit exceeded', async () => {
      await expect(service.assertQuota('org-123', 'quota.projects', 5, 1)).rejects.toThrow(
        BillingQuotaExceededError
      );
    });

    it('assertQuota allows any usage when quota is unlimited (-1)', async () => {
      const limit = await service.assertQuota('org-123', 'quota.unlimited_feature', 999_999, 100);
      expect(limit).toBe(-1);
    });
  });

  describe('Provider Entitlements', () => {
    it('checks canonical provider access (integrations.slack)', async () => {
      const slackAllowed = await service.getProviderEntitlement('org-123', 'slack');
      expect(slackAllowed).toBe(true);

      const discordAllowed = await service.getProviderEntitlement('org-123', 'discord');
      expect(discordAllowed).toBe(false);
    });
  });

  describe('In-Memory Caching & Invalidation', () => {
    it('caches repository responses and serves cached results', async () => {
      await service.getEffectiveBooleanFeature('org-123', 'alerting.enabled');
      await service.getEffectiveIntegerFeature('org-123', 'quota.projects');
      expect(mockRepo.getEffectiveEntitlements).toHaveBeenCalledTimes(1);

      service.invalidateOrgCache('org-123');
      await service.getEffectiveBooleanFeature('org-123', 'alerting.enabled');
      expect(mockRepo.getEffectiveEntitlements).toHaveBeenCalledTimes(2);
    });
  });

  describe('QuotaGuard Concurrency Guard', () => {
    it('assertWithinLimit delegates to entitlements assertQuota', async () => {
      await expect(
        guard.assertWithinLimit({
          organizationId: 'org-123',
          quotaKey: 'quota.projects',
          currentUsage: 4,
          requestedUnits: 1,
        })
      ).resolves.toBe(5);

      await expect(
        guard.assertWithinLimit({
          organizationId: 'org-123',
          quotaKey: 'quota.projects',
          currentUsage: 5,
          requestedUnits: 1,
        })
      ).rejects.toThrow(BillingQuotaExceededError);
    });

    it('assertCanCreate with client executes advisory lock', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };

      const limit = await guard.assertCanCreate({
        client: mockClient as any,
        organizationId: 'org-123',
        quotaKey: 'quota.projects',
        currentUsage: 2,
        requestedUnits: 1,
      });

      expect(limit).toBe(5);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        ['org-123', 'quota.projects']
      );
    });
  });
});
