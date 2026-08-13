/**
 * Standardized error contract for the Billing & Entitlement subsystem.
 */
export declare class BillingError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly details: Record<string, unknown> | undefined;
    constructor(message: string, code: string, statusCode?: number, details?: Record<string, unknown>);
}
export declare class BillingFeatureDisabledError extends BillingError {
    constructor(featureKey: string, organizationId?: string);
}
export declare class BillingQuotaExceededError extends BillingError {
    constructor(quotaKey: string, limit: number, currentUsage: number, requestedUnits?: number, organizationId?: string);
}
export declare class SubscriptionInactiveError extends BillingError {
    constructor(organizationId: string, status?: string);
}
export declare class BillingEntitlementUnavailableError extends BillingError {
    constructor(featureKey: string, organizationId: string);
}
//# sourceMappingURL=errors.d.ts.map