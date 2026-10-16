import { EntitlementsRepository } from './repository.js';
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
export type OrgInvalidationListener = (orgId: string) => void;
export declare class EntitlementsService {
    private readonly repository;
    private readonly cache;
    private readonly defaultTtlMs;
    private readonly listeners;
    private readonly inFlightLoads;
    constructor(repository?: EntitlementsRepository, options?: {
        maxCachedOrgs?: number;
        ttlMs?: number;
    });
    /** Register a callback invoked whenever an organization's billing state / entitlements are invalidated */
    onOrgInvalidate(listener: OrgInvalidationListener): () => void;
    /** Invalidate cached entitlements for an organization (e.g. after subscription or override changes) */
    invalidateOrgCache(orgId: string): void;
    /** Clear entire in-memory entitlement cache */
    clearCache(): void;
    private getOrLoadOrgEntitlements;
    /**
     * Get all resolved effective entitlements as a key-value dictionary for an organization.
     */
    getEffectiveEntitlements(orgId: string): Promise<EntitlementsMap>;
    /**
     * Return full map formatted for legacy/API controllers.
     */
    getAllEntitlements(orgId: string): Promise<{
        success: boolean;
        data: EntitlementsMap;
    }>;
    /**
     * Get effective raw feature object for a feature key (or null if unentitled).
     */
    getEffectiveFeature(orgId: string, featureKey: string): Promise<EffectiveFeatureValue | null>;
    /**
     * Get boolean value for a feature. Fail-closed: returns false if not explicitly true.
     */
    getEffectiveBooleanFeature(orgId: string, featureKey: string): Promise<boolean>;
    /**
     * Check if a feature is enabled (alias for getEffectiveBooleanFeature).
     */
    hasFeature(orgId: string, featureKey: string): Promise<boolean>;
    /**
     * Get effective integer limit/quota.
     * Fail-closed: returns 0 if missing or unset.
     * Unlimited is explicitly represented as -1.
     */
    getEffectiveIntegerFeature(orgId: string, featureKey: string): Promise<number>;
    /**
     * Get effective decimal value for a feature.
     */
    getEffectiveDecimalFeature(orgId: string, featureKey: string): Promise<number | null>;
    /**
     * Get effective string value for a feature.
     */
    getEffectiveStringFeature(orgId: string, featureKey: string): Promise<string | null>;
    /**
     * Get active subscription state for an organization.
     */
    getSubscriptionState(orgId: string): Promise<SubscriptionStateInfo | null>;
    /**
     * Check provider entitlement (e.g. provider = 'slack' checks 'integrations.slack').
     */
    getProviderEntitlement(orgId: string, provider: string): Promise<boolean>;
    /**
     * Assert that a boolean feature is enabled. Throws BillingFeatureDisabledError if not.
     */
    assertFeatureEnabled(orgId: string, featureKey: string): Promise<void>;
    /**
     * Assert that an organization has not exceeded an integer quota.
     * Throws BillingQuotaExceededError if limit is reached/exceeded.
     * Explicit limit of -1 means unlimited.
     */
    assertQuota(orgId: string, quotaKey: string, currentUsage: number, requestedUnits?: number): Promise<number>;
    /**
     * Helper check method for public routes.
     */
    checkFeatureAccess(orgId: string, featureKey: string, quantity?: number): Promise<{
        success: boolean;
        data: {
            granted: boolean;
            limit?: number;
            reason?: string;
        };
    }>;
}
export declare const entitlementsService: EntitlementsService;
//# sourceMappingURL=service.d.ts.map