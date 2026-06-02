/**
 * Quota management service.
 *
 * Flow:
 * 1. Load organization billing, plan limits, and current usage counters.
 * 2. Resolve the relevant plan limit for the requested usage metric.
 * 3. Check whether the requested increment would exceed the limit.
 * 4. Return allowed/current/limit/remaining data for callers that need to gate
 *    API work before it is performed.
 */
import { BillingRepository } from './repository.js';
import { UsageMetricType } from './types.js';
import type { ServiceResponse } from './types.js';
export declare class QuotaService {
    private repository;
    constructor(repository: BillingRepository);
    checkQuota(orgId: string, metricType: UsageMetricType, requestedAmount?: number): Promise<ServiceResponse<{
        allowed: boolean;
        current: number;
        limit: number | null;
        remaining: number;
    }>>;
    checkIngestionQuota(orgId: string, requestedApiRequests: number): Promise<ServiceResponse<{
        allowed: boolean;
        current: number;
        limit: number | null;
        remaining: number;
        subscriptionStatus: string;
        reason?: string;
    }>>;
    incrementUsage(orgId: string, metricType: UsageMetricType, amount?: number): Promise<ServiceResponse<{
        newTotal: number;
    }>>;
    getUsageReport(orgId: string): Promise<ServiceResponse<any>>;
    private getLimitFromPlan;
}
//# sourceMappingURL=quota-service.d.ts.map