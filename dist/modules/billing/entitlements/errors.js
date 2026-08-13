/**
 * Standardized error contract for the Billing & Entitlement subsystem.
 */
export class BillingError extends Error {
    code;
    statusCode;
    details;
    constructor(message, code, statusCode = 400, details) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
export class BillingFeatureDisabledError extends BillingError {
    constructor(featureKey, organizationId) {
        super(`Feature '${featureKey}' is not enabled for this organization's active subscription plan.`, 'BILLING_FEATURE_DISABLED', 403, { featureKey, organizationId });
    }
}
export class BillingQuotaExceededError extends BillingError {
    constructor(quotaKey, limit, currentUsage, requestedUnits = 1, organizationId) {
        super(`Quota limit exceeded for '${quotaKey}'. Limit: ${limit}, Current usage: ${currentUsage}, Requested: ${requestedUnits}.`, 'BILLING_QUOTA_EXCEEDED', 403, { quotaKey, limit, currentUsage, requestedUnits, organizationId });
    }
}
export class SubscriptionInactiveError extends BillingError {
    constructor(organizationId, status) {
        super(`Organization subscription is not active (current status: '${status ?? 'none'}').`, 'SUBSCRIPTION_INACTIVE', 402, { organizationId, status });
    }
}
export class BillingEntitlementUnavailableError extends BillingError {
    constructor(featureKey, organizationId) {
        super(`Entitlement for '${featureKey}' is unavailable or misconfigured for organization '${organizationId}'.`, 'BILLING_ENTITLEMENT_UNAVAILABLE', 500, { featureKey, organizationId });
    }
}
//# sourceMappingURL=errors.js.map