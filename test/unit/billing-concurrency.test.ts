import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotaGuard } from '../../src/modules/billing/entitlements/quota-guard.js';
import { BillingQuotaExceededError } from '../../src/modules/billing/entitlements/errors.js';
import type { EntitlementsService } from '../../src/modules/billing/entitlements/service.js';

describe('QuotaGuard Concurrency & Transactional Locking', () => {
  let mockEntitlements: Partial<EntitlementsService>;
  let quotaGuard: QuotaGuard;

  beforeEach(() => {
    mockEntitlements = {
      getEffectiveIntegerFeature: vi.fn(),
      assertQuota: vi.fn(),
    };
    quotaGuard = new QuotaGuard(mockEntitlements as EntitlementsService);
  });

  it('allows creation when current usage + requested is within quota limit', async () => {
    vi.spyOn(mockEntitlements, 'getEffectiveIntegerFeature').mockResolvedValue(10);
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const limit = await quotaGuard.assertCanCreate({
      client: mockClient as any,
      organizationId: 'org_123',
      quotaKey: 'quota.projects',
      currentUsage: 5,
      requestedUnits: 1,
    });

    expect(limit).toBe(10);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      ['org_123', 'quota.projects']
    );
  });

  it('rejects creation and throws BillingQuotaExceededError when quota is reached', async () => {
    vi.spyOn(mockEntitlements, 'getEffectiveIntegerFeature').mockResolvedValue(10);
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    await expect(
      quotaGuard.assertCanCreate({
        client: mockClient as any,
        organizationId: 'org_123',
        quotaKey: 'quota.projects',
        currentUsage: 10,
        requestedUnits: 1,
      })
    ).rejects.toThrow(BillingQuotaExceededError);

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      ['org_123', 'quota.projects']
    );
  });

  it('correctly executes fetchCurrentUsage callback after acquiring advisory lock', async () => {
    vi.spyOn(mockEntitlements, 'getEffectiveIntegerFeature').mockResolvedValue(5);
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const fetcher = vi.fn().mockResolvedValue(4);

    const limit = await quotaGuard.assertCanCreate({
      client: mockClient as any,
      organizationId: 'org_123',
      quotaKey: 'quota.connectors',
      requestedUnits: 1,
      fetchCurrentUsage: fetcher,
    });

    expect(limit).toBe(5);
    expect(fetcher).toHaveBeenCalledWith(mockClient);
  });

  it('prevents over-quota creation in simulated race condition with fetchCurrentUsage', async () => {
    vi.spyOn(mockEntitlements, 'getEffectiveIntegerFeature').mockResolvedValue(5);
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    // fetcher returns 5 (quota full)
    const fetcher = vi.fn().mockResolvedValue(5);

    await expect(
      quotaGuard.assertCanCreate({
        client: mockClient as any,
        organizationId: 'org_123',
        quotaKey: 'quota.connectors',
        requestedUnits: 1,
        fetchCurrentUsage: fetcher,
      })
    ).rejects.toThrow(BillingQuotaExceededError);
  });

  it('allows creation when limit is explicitly unlimited (-1)', async () => {
    vi.spyOn(mockEntitlements, 'getEffectiveIntegerFeature').mockResolvedValue(-1);
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const limit = await quotaGuard.assertCanCreate({
      client: mockClient as any,
      organizationId: 'org_123',
      quotaKey: 'quota.monthly_events',
      currentUsage: 10_000_000,
      requestedUnits: 100,
    });

    expect(limit).toBe(-1);
  });
});
