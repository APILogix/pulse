import { LRUCache } from 'lru-cache';
import { registerL1Cache, publishInvalidation } from '../../../shared/cache/invalidation-bus.js';
import { CacheFlags } from '../../../config/cache-flags.js';
import { recordCacheRequest } from '../../../config/perf/metrics.js';
import { EntitlementsRepository, type EffectiveEntitlementRow } from './repository.js';
import {
  BillingFeatureDisabledError,
  BillingQuotaExceededError,
  SubscriptionInactiveError,
} from './errors.js';

export interface EffectiveFeatureValue {
  booleanValue: boolean | null;
  integerValue: number | null;
  decimalValue: number | null;
  stringValue: string | null;
}

export type EntitlementsMap = Record<string, EffectiveFeatureValue>;

export interface SubscriptionStateInfo {
  subscriptionId: string;
  planId: string;
  planKey: string;
  planTier: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

interface CachedOrgEntitlements {
  map: EntitlementsMap;
  subscription: SubscriptionStateInfo | null;
  cachedAt: number;
}

export type OrgInvalidationListener = (orgId: string) => void;

export class EntitlementsService {
  private readonly cache: LRUCache<string, CachedOrgEntitlements>;
  private readonly defaultTtlMs: number;
  private readonly listeners: Set<OrgInvalidationListener> = new Set();
  private readonly inFlightLoads = new Map<string, Promise<CachedOrgEntitlements>>();

  constructor(
    private readonly repository: EntitlementsRepository = new EntitlementsRepository(),
    options: { maxCachedOrgs?: number; ttlMs?: number } = {}
  ) {
    this.defaultTtlMs = options.ttlMs ?? 60_000; // 60 seconds TTL
    this.cache = new LRUCache<string, CachedOrgEntitlements>({
      max: options.maxCachedOrgs ?? 5_000,
      ttl: this.defaultTtlMs,
      updateAgeOnGet: false,
    });
    registerL1Cache('entitlements', this.cache);
  }

  /** Register a callback invoked whenever an organization's billing state / entitlements are invalidated */
  onOrgInvalidate(listener: OrgInvalidationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Invalidate cached entitlements for an organization (e.g. after subscription or override changes) */
  invalidateOrgCache(orgId: string): void {
    this.cache.delete(orgId);
    this.inFlightLoads.delete(orgId);
    void publishInvalidation('entitlements', orgId);
    for (const listener of this.listeners) {
      try {
        listener(orgId);
      } catch {
        // Listeners must never fail caller
      }
    }
  }

  /** Clear entire in-memory entitlement cache */
  clearCache(): void {
    this.cache.clear();
    this.inFlightLoads.clear();
  }

  private async getOrLoadOrgEntitlements(orgId: string): Promise<CachedOrgEntitlements> {
    const cached = this.cache.get(orgId);
    if (cached) {
      recordCacheRequest('entitlements', 'hit');
      return cached;
    }
    recordCacheRequest('entitlements', 'miss');

    if (!CacheFlags.entitlementsSingleFlight) {
      // Legacy behavior (kill-switch fallback)
      const [rows, sub] = await Promise.all([
        this.repository.getEffectiveEntitlements(orgId),
        this.repository.getSubscriptionState(orgId),
      ]);
      const map: EntitlementsMap = {};
      for (const curr of rows) {
        map[curr.feature_key] = {
          booleanValue: curr.boolean_value,
          integerValue: curr.integer_value !== null ? Number(curr.integer_value) : null,
          decimalValue: curr.decimal_value !== null ? Number(curr.decimal_value) : null,
          stringValue: curr.string_value,
        };
      }
      const entry: CachedOrgEntitlements = {
        map,
        subscription: sub,
        cachedAt: Date.now(),
      };
      this.cache.set(orgId, entry);
      return entry;
    }

    const inFlight = this.inFlightLoads.get(orgId);
    if (inFlight) {
      return inFlight;
    }

    const loadPromise = (async () => {
      try {
        const [rows, sub] = await Promise.all([
          this.repository.getEffectiveEntitlements(orgId),
          this.repository.getSubscriptionState(orgId),
        ]);

        const map: EntitlementsMap = {};
        for (const curr of rows) {
          map[curr.feature_key] = {
            booleanValue: curr.boolean_value,
            integerValue: curr.integer_value !== null ? Number(curr.integer_value) : null,
            decimalValue: curr.decimal_value !== null ? Number(curr.decimal_value) : null,
            stringValue: curr.string_value,
          };
        }

        const entry: CachedOrgEntitlements = {
          map,
          subscription: sub,
          cachedAt: Date.now(),
        };

        this.cache.set(orgId, entry);
        return entry;
      } finally {
        this.inFlightLoads.delete(orgId);
      }
    })();

    this.inFlightLoads.set(orgId, loadPromise);
    return loadPromise;
  }

  /**
   * Get all resolved effective entitlements as a key-value dictionary for an organization.
   */
  async getEffectiveEntitlements(orgId: string): Promise<EntitlementsMap> {
    const { map } = await this.getOrLoadOrgEntitlements(orgId);
    return map;
  }

  /**
   * Return full map formatted for legacy/API controllers.
   */
  async getAllEntitlements(orgId: string): Promise<{ success: boolean; data: EntitlementsMap }> {
    const map = await this.getEffectiveEntitlements(orgId);
    return { success: true, data: map };
  }

  /**
   * Get effective raw feature object for a feature key (or null if unentitled).
   */
  async getEffectiveFeature(orgId: string, featureKey: string): Promise<EffectiveFeatureValue | null> {
    const map = await this.getEffectiveEntitlements(orgId);
    return map[featureKey] ?? null;
  }

  /**
   * Get boolean value for a feature. Fail-closed: returns false if not explicitly true.
   */
  async getEffectiveBooleanFeature(orgId: string, featureKey: string): Promise<boolean> {
    const feature = await this.getEffectiveFeature(orgId, featureKey);
    return feature?.booleanValue === true;
  }

  /**
   * Check if a feature is enabled (alias for getEffectiveBooleanFeature).
   */
  async hasFeature(orgId: string, featureKey: string): Promise<boolean> {
    return this.getEffectiveBooleanFeature(orgId, featureKey);
  }

  /**
   * Get effective integer limit/quota.
   * Fail-closed: returns 0 if missing or unset.
   * Unlimited is explicitly represented as -1.
   */
  async getEffectiveIntegerFeature(orgId: string, featureKey: string): Promise<number> {
    const feature = await this.getEffectiveFeature(orgId, featureKey);
    if (!feature || feature.integerValue === null || feature.integerValue === undefined) {
      return 0;
    }
    return feature.integerValue;
  }

  /**
   * Get effective decimal value for a feature.
   */
  async getEffectiveDecimalFeature(orgId: string, featureKey: string): Promise<number | null> {
    const feature = await this.getEffectiveFeature(orgId, featureKey);
    return feature?.decimalValue ?? null;
  }

  /**
   * Get effective string value for a feature.
   */
  async getEffectiveStringFeature(orgId: string, featureKey: string): Promise<string | null> {
    const feature = await this.getEffectiveFeature(orgId, featureKey);
    return feature?.stringValue ?? null;
  }

  /**
   * Get active subscription state for an organization.
   */
  async getSubscriptionState(orgId: string): Promise<SubscriptionStateInfo | null> {
    const { subscription } = await this.getOrLoadOrgEntitlements(orgId);
    return subscription;
  }

  /**
   * Check provider entitlement (e.g. provider = 'slack' checks 'integrations.slack').
   */
  async getProviderEntitlement(orgId: string, provider: string): Promise<boolean> {
    const canonicalKey = `integrations.${provider.toLowerCase()}`;
    return this.getEffectiveBooleanFeature(orgId, canonicalKey);
  }

  /**
   * Assert that a boolean feature is enabled. Throws BillingFeatureDisabledError if not.
   */
  async assertFeatureEnabled(orgId: string, featureKey: string): Promise<void> {
    const enabled = await this.getEffectiveBooleanFeature(orgId, featureKey);
    if (!enabled) {
      throw new BillingFeatureDisabledError(featureKey, orgId);
    }
  }

  /**
   * Assert that an organization has not exceeded an integer quota.
   * Throws BillingQuotaExceededError if limit is reached/exceeded.
   * Explicit limit of -1 means unlimited.
   */
  async assertQuota(
    orgId: string,
    quotaKey: string,
    currentUsage: number,
    requestedUnits: number = 1
  ): Promise<number> {
    const limit = await this.getEffectiveIntegerFeature(orgId, quotaKey);
    if (limit === -1) {
      // Explicit unlimited
      return limit;
    }

    if (currentUsage + requestedUnits > limit) {
      throw new BillingQuotaExceededError(quotaKey, limit, currentUsage, requestedUnits, orgId);
    }

    return limit;
  }

  /**
   * Helper check method for public routes.
   */
  async checkFeatureAccess(orgId: string, featureKey: string, quantity: number = 1): Promise<{
    success: boolean;
    data: { granted: boolean; limit?: number; reason?: string };
  }> {
    const feature = await this.getEffectiveFeature(orgId, featureKey);
    if (!feature) {
      return { success: true, data: { granted: false, reason: 'feature_not_included_or_limit_exceeded' } };
    }

    if (feature.booleanValue !== null) {
      return { success: true, data: { granted: feature.booleanValue } };
    }

    if (feature.integerValue !== null) {
      const limit = feature.integerValue;
      if (limit === -1) {
        return { success: true, data: { granted: true, limit } };
      }
      return { success: true, data: { granted: limit >= quantity, limit } };
    }

    return { success: true, data: { granted: true } };
  }
}

// Export singleton instance for platform-wide reuse
export const entitlementsService = new EntitlementsService();
