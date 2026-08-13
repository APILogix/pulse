import { LRUCache } from 'lru-cache';
import { EntitlementsRepository } from './repository.js';
import { BillingFeatureDisabledError, BillingQuotaExceededError, SubscriptionInactiveError, } from './errors.js';
export class EntitlementsService {
    repository;
    cache;
    defaultTtlMs;
    listeners = new Set();
    constructor(repository = new EntitlementsRepository(), options = {}) {
        this.repository = repository;
        this.defaultTtlMs = options.ttlMs ?? 60_000; // 60 seconds TTL
        this.cache = new LRUCache({
            max: options.maxCachedOrgs ?? 5_000,
            ttl: this.defaultTtlMs,
        });
    }
    /** Register a callback invoked whenever an organization's billing state / entitlements are invalidated */
    onOrgInvalidate(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    /** Invalidate cached entitlements for an organization (e.g. after subscription or override changes) */
    invalidateOrgCache(orgId) {
        this.cache.delete(orgId);
        for (const listener of this.listeners) {
            try {
                listener(orgId);
            }
            catch {
                // Listeners must never fail caller
            }
        }
    }
    /** Clear entire in-memory entitlement cache */
    clearCache() {
        this.cache.clear();
    }
    async getOrLoadOrgEntitlements(orgId) {
        const cached = this.cache.get(orgId);
        if (cached) {
            return cached;
        }
        const [rows, sub] = await Promise.all([
            this.repository.getEffectiveEntitlements(orgId),
            this.repository.getSubscriptionState(orgId),
        ]);
        const map = {};
        for (const curr of rows) {
            map[curr.feature_key] = {
                booleanValue: curr.boolean_value,
                integerValue: curr.integer_value !== null ? Number(curr.integer_value) : null,
                decimalValue: curr.decimal_value !== null ? Number(curr.decimal_value) : null,
                stringValue: curr.string_value,
            };
        }
        const entry = {
            map,
            subscription: sub,
            cachedAt: Date.now(),
        };
        this.cache.set(orgId, entry);
        return entry;
    }
    /**
     * Get all resolved effective entitlements as a key-value dictionary for an organization.
     */
    async getEffectiveEntitlements(orgId) {
        const { map } = await this.getOrLoadOrgEntitlements(orgId);
        return map;
    }
    /**
     * Return full map formatted for legacy/API controllers.
     */
    async getAllEntitlements(orgId) {
        const map = await this.getEffectiveEntitlements(orgId);
        return { success: true, data: map };
    }
    /**
     * Get effective raw feature object for a feature key (or null if unentitled).
     */
    async getEffectiveFeature(orgId, featureKey) {
        const map = await this.getEffectiveEntitlements(orgId);
        return map[featureKey] ?? null;
    }
    /**
     * Get boolean value for a feature. Fail-closed: returns false if not explicitly true.
     */
    async getEffectiveBooleanFeature(orgId, featureKey) {
        const feature = await this.getEffectiveFeature(orgId, featureKey);
        return feature?.booleanValue === true;
    }
    /**
     * Check if a feature is enabled (alias for getEffectiveBooleanFeature).
     */
    async hasFeature(orgId, featureKey) {
        return this.getEffectiveBooleanFeature(orgId, featureKey);
    }
    /**
     * Get effective integer limit/quota.
     * Fail-closed: returns 0 if missing or unset.
     * Unlimited is explicitly represented as -1.
     */
    async getEffectiveIntegerFeature(orgId, featureKey) {
        const feature = await this.getEffectiveFeature(orgId, featureKey);
        if (!feature || feature.integerValue === null || feature.integerValue === undefined) {
            return 0;
        }
        return feature.integerValue;
    }
    /**
     * Get effective decimal value for a feature.
     */
    async getEffectiveDecimalFeature(orgId, featureKey) {
        const feature = await this.getEffectiveFeature(orgId, featureKey);
        return feature?.decimalValue ?? null;
    }
    /**
     * Get effective string value for a feature.
     */
    async getEffectiveStringFeature(orgId, featureKey) {
        const feature = await this.getEffectiveFeature(orgId, featureKey);
        return feature?.stringValue ?? null;
    }
    /**
     * Get active subscription state for an organization.
     */
    async getSubscriptionState(orgId) {
        const { subscription } = await this.getOrLoadOrgEntitlements(orgId);
        return subscription;
    }
    /**
     * Check provider entitlement (e.g. provider = 'slack' checks 'integrations.slack').
     */
    async getProviderEntitlement(orgId, provider) {
        const canonicalKey = `integrations.${provider.toLowerCase()}`;
        return this.getEffectiveBooleanFeature(orgId, canonicalKey);
    }
    /**
     * Assert that a boolean feature is enabled. Throws BillingFeatureDisabledError if not.
     */
    async assertFeatureEnabled(orgId, featureKey) {
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
    async assertQuota(orgId, quotaKey, currentUsage, requestedUnits = 1) {
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
    async checkFeatureAccess(orgId, featureKey, quantity = 1) {
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
//# sourceMappingURL=service.js.map