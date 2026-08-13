/**
 * Standardized error contract for the Billing & Entitlement subsystem.
 */

export class BillingError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown> | undefined;

  constructor(message: string, code: string, statusCode: number = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BillingFeatureDisabledError extends BillingError {
  constructor(featureKey: string, organizationId?: string) {
    super(
      `Feature '${featureKey}' is not enabled for this organization's active subscription plan.`,
      'BILLING_FEATURE_DISABLED',
      403,
      { featureKey, organizationId }
    );
  }
}

export class BillingQuotaExceededError extends BillingError {
  constructor(quotaKey: string, limit: number, currentUsage: number, requestedUnits: number = 1, organizationId?: string) {
    super(
      `Quota limit exceeded for '${quotaKey}'. Limit: ${limit}, Current usage: ${currentUsage}, Requested: ${requestedUnits}.`,
      'BILLING_QUOTA_EXCEEDED',
      403,
      { quotaKey, limit, currentUsage, requestedUnits, organizationId }
    );
  }
}

export class SubscriptionInactiveError extends BillingError {
  constructor(organizationId: string, status?: string) {
    super(
      `Organization subscription is not active (current status: '${status ?? 'none'}').`,
      'SUBSCRIPTION_INACTIVE',
      402,
      { organizationId, status }
    );
  }
}

export class BillingEntitlementUnavailableError extends BillingError {
  constructor(featureKey: string, organizationId: string) {
    super(
      `Entitlement for '${featureKey}' is unavailable or misconfigured for organization '${organizationId}'.`,
      'BILLING_ENTITLEMENT_UNAVAILABLE',
      500,
      { featureKey, organizationId }
    );
  }
}
