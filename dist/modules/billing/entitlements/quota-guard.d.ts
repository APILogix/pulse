import type { PoolClient } from 'pg';
import { type EntitlementsService } from './service.js';
export interface AssertWithinLimitParams {
    organizationId: string;
    quotaKey: string;
    currentUsage: number;
    requestedUnits?: number;
}
export interface AssertCanCreateParams {
    client?: PoolClient;
    organizationId: string;
    quotaKey: string;
    currentUsage?: number;
    requestedUnits?: number;
    fetchCurrentUsage?: (client: PoolClient) => Promise<number>;
}
export declare class QuotaGuard {
    private readonly entitlements;
    constructor(entitlements?: EntitlementsService);
    /**
     * Assert that an organization has not reached or exceeded its limit for a given quota key.
     * Throws BillingQuotaExceededError if limit is exceeded.
     */
    assertWithinLimit(params: AssertWithinLimitParams): Promise<number>;
    /**
     * Concurrency-safe creation guard.
     * When client is provided in a transaction, acquires an advisory xact lock for the org and quota key
     * before checking usage against limit to prevent race conditions.
     */
    assertCanCreate(params: AssertCanCreateParams): Promise<number>;
}
export declare const quotaGuard: QuotaGuard;
//# sourceMappingURL=quota-guard.d.ts.map