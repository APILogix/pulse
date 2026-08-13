import { entitlementsService } from './service.js';
import { BillingQuotaExceededError } from './errors.js';
export class QuotaGuard {
    entitlements;
    constructor(entitlements = entitlementsService) {
        this.entitlements = entitlements;
    }
    /**
     * Assert that an organization has not reached or exceeded its limit for a given quota key.
     * Throws BillingQuotaExceededError if limit is exceeded.
     */
    async assertWithinLimit(params) {
        const requestedUnits = params.requestedUnits ?? 1;
        return this.entitlements.assertQuota(params.organizationId, params.quotaKey, params.currentUsage, requestedUnits);
    }
    /**
     * Concurrency-safe creation guard.
     * When client is provided in a transaction, acquires an advisory xact lock for the org and quota key
     * before checking usage against limit to prevent race conditions.
     */
    async assertCanCreate(params) {
        const requestedUnits = params.requestedUnits ?? 1;
        if (params.client) {
            // Use PostgreSQL advisory transaction lock scoped to (hashtext(orgId), hashtext(quotaKey))
            await params.client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [params.organizationId, params.quotaKey]);
        }
        const limit = await this.entitlements.getEffectiveIntegerFeature(params.organizationId, params.quotaKey);
        if (limit === -1) {
            // Explicit unlimited
            return limit;
        }
        let usage = params.currentUsage ?? 0;
        if (params.fetchCurrentUsage && params.client) {
            usage = await params.fetchCurrentUsage(params.client);
        }
        if (usage + requestedUnits > limit) {
            throw new BillingQuotaExceededError(params.quotaKey, limit, usage, requestedUnits, params.organizationId);
        }
        return limit;
    }
}
export const quotaGuard = new QuotaGuard();
//# sourceMappingURL=quota-guard.js.map