/**
 * Centralized Error Code Registry for Platform-Wide API Responses.
 *
 * Each error code defines its default machine-readable code, HTTP status,
 * default safe message, client safety flag, and category.
 */
export interface ErrorCodeDefinition {
    code: string;
    status: number;
    message: string;
    safeForClient: boolean;
    category: 'validation' | 'auth' | 'authorization' | 'not_found' | 'conflict' | 'business_rule' | 'rate_limit' | 'internal' | 'upstream';
}
export declare const ERROR_CODES: {
    readonly VALIDATION_ERROR: {
        readonly code: "VALIDATION_ERROR";
        readonly status: 400;
        readonly message: "Please check your input and try again.";
        readonly safeForClient: true;
        readonly category: "validation";
    };
    readonly INVALID_REQUEST: {
        readonly code: "INVALID_REQUEST";
        readonly status: 400;
        readonly message: "The request is invalid or malformed.";
        readonly safeForClient: true;
        readonly category: "validation";
    };
    readonly INVALID_PARAMETER: {
        readonly code: "INVALID_PARAMETER";
        readonly status: 400;
        readonly message: "One or more request parameters are invalid.";
        readonly safeForClient: true;
        readonly category: "validation";
    };
    readonly AUTHENTICATION_REQUIRED: {
        readonly code: "AUTHENTICATION_REQUIRED";
        readonly status: 401;
        readonly message: "Authentication is required to access this resource.";
        readonly safeForClient: true;
        readonly category: "auth";
    };
    readonly INVALID_CREDENTIALS: {
        readonly code: "INVALID_CREDENTIALS";
        readonly status: 401;
        readonly message: "Invalid email or password.";
        readonly safeForClient: true;
        readonly category: "auth";
    };
    readonly INVALID_TOKEN: {
        readonly code: "INVALID_TOKEN";
        readonly status: 401;
        readonly message: "Invalid or expired token.";
        readonly safeForClient: true;
        readonly category: "auth";
    };
    readonly TOKEN_EXPIRED: {
        readonly code: "TOKEN_EXPIRED";
        readonly status: 401;
        readonly message: "Your token has expired. Please request a new one.";
        readonly safeForClient: true;
        readonly category: "auth";
    };
    readonly SESSION_EXPIRED: {
        readonly code: "SESSION_EXPIRED";
        readonly status: 401;
        readonly message: "Your session has expired. Please sign in again.";
        readonly safeForClient: true;
        readonly category: "auth";
    };
    readonly MFA_REQUIRED: {
        readonly code: "MFA_REQUIRED";
        readonly status: 401;
        readonly message: "Multi-factor authentication is required.";
        readonly safeForClient: true;
        readonly category: "auth";
    };
    readonly MFA_INVALID: {
        readonly code: "MFA_INVALID";
        readonly status: 401;
        readonly message: "Invalid MFA code.";
        readonly safeForClient: true;
        readonly category: "auth";
    };
    readonly FORBIDDEN: {
        readonly code: "FORBIDDEN";
        readonly status: 403;
        readonly message: "You do not have permission to perform this action.";
        readonly safeForClient: true;
        readonly category: "authorization";
    };
    readonly INSUFFICIENT_PERMISSIONS: {
        readonly code: "INSUFFICIENT_PERMISSIONS";
        readonly status: 403;
        readonly message: "You do not have permission to perform this action.";
        readonly safeForClient: true;
        readonly category: "authorization";
    };
    readonly FEATURE_NOT_AVAILABLE: {
        readonly code: "FEATURE_NOT_AVAILABLE";
        readonly status: 403;
        readonly message: "This feature is not available on your current plan.";
        readonly safeForClient: true;
        readonly category: "authorization";
    };
    readonly PLAN_RESTRICTION: {
        readonly code: "PLAN_RESTRICTION";
        readonly status: 403;
        readonly message: "Action restricted by your organization subscription plan.";
        readonly safeForClient: true;
        readonly category: "authorization";
    };
    readonly STEP_UP_REQUIRED: {
        readonly code: "STEP_UP_REQUIRED";
        readonly status: 403;
        readonly message: "Additional verification is required to complete this action.";
        readonly safeForClient: true;
        readonly category: "authorization";
    };
    readonly NOT_FOUND: {
        readonly code: "NOT_FOUND";
        readonly status: 404;
        readonly message: "The requested resource was not found.";
        readonly safeForClient: true;
        readonly category: "not_found";
    };
    readonly RESOURCE_NOT_FOUND: {
        readonly code: "RESOURCE_NOT_FOUND";
        readonly status: 404;
        readonly message: "The requested resource was not found.";
        readonly safeForClient: true;
        readonly category: "not_found";
    };
    readonly USER_NOT_FOUND: {
        readonly code: "USER_NOT_FOUND";
        readonly status: 404;
        readonly message: "User not found.";
        readonly safeForClient: true;
        readonly category: "not_found";
    };
    readonly PROJECT_NOT_FOUND: {
        readonly code: "PROJECT_NOT_FOUND";
        readonly status: 404;
        readonly message: "Project not found.";
        readonly safeForClient: true;
        readonly category: "not_found";
    };
    readonly ORGANIZATION_NOT_FOUND: {
        readonly code: "ORGANIZATION_NOT_FOUND";
        readonly status: 404;
        readonly message: "Organization not found.";
        readonly safeForClient: true;
        readonly category: "not_found";
    };
    readonly CONNECTOR_NOT_FOUND: {
        readonly code: "CONNECTOR_NOT_FOUND";
        readonly status: 404;
        readonly message: "Connector not found.";
        readonly safeForClient: true;
        readonly category: "not_found";
    };
    readonly RESOURCE_CONFLICT: {
        readonly code: "RESOURCE_CONFLICT";
        readonly status: 409;
        readonly message: "Resource conflict occurred.";
        readonly safeForClient: true;
        readonly category: "conflict";
    };
    readonly DUPLICATE_RESOURCE: {
        readonly code: "DUPLICATE_RESOURCE";
        readonly status: 409;
        readonly message: "A resource with these details already exists.";
        readonly safeForClient: true;
        readonly category: "conflict";
    };
    readonly RESOURCE_ALREADY_EXISTS: {
        readonly code: "RESOURCE_ALREADY_EXISTS";
        readonly status: 409;
        readonly message: "A resource with these details already exists.";
        readonly safeForClient: true;
        readonly category: "conflict";
    };
    readonly QUOTA_CONFLICT: {
        readonly code: "QUOTA_CONFLICT";
        readonly status: 409;
        readonly message: "Conflict with existing resource quota.";
        readonly safeForClient: true;
        readonly category: "conflict";
    };
    readonly BUSINESS_RULE_VIOLATION: {
        readonly code: "BUSINESS_RULE_VIOLATION";
        readonly status: 422;
        readonly message: "Operation violates application business rules.";
        readonly safeForClient: true;
        readonly category: "business_rule";
    };
    readonly INVALID_STATE_TRANSITION: {
        readonly code: "INVALID_STATE_TRANSITION";
        readonly status: 422;
        readonly message: "Operation is not allowed in the current resource state.";
        readonly safeForClient: true;
        readonly category: "business_rule";
    };
    readonly UNPROCESSABLE_ENTITY: {
        readonly code: "UNPROCESSABLE_ENTITY";
        readonly status: 422;
        readonly message: "Unprocessable entity.";
        readonly safeForClient: true;
        readonly category: "business_rule";
    };
    readonly RATE_LIMIT_EXCEEDED: {
        readonly code: "RATE_LIMIT_EXCEEDED";
        readonly status: 429;
        readonly message: "Too many requests. Please try again shortly.";
        readonly safeForClient: true;
        readonly category: "rate_limit";
    };
    readonly QUOTA_EXCEEDED: {
        readonly code: "QUOTA_EXCEEDED";
        readonly status: 429;
        readonly message: "You have reached your resource quota for your current plan.";
        readonly safeForClient: true;
        readonly category: "rate_limit";
    };
    readonly AI_CREDITS_EXHAUSTED: {
        readonly code: "AI_CREDITS_EXHAUSTED";
        readonly status: 429;
        readonly message: "AI intelligence credits exhausted for current billing period.";
        readonly safeForClient: true;
        readonly category: "rate_limit";
    };
    readonly INTERNAL_ERROR: {
        readonly code: "INTERNAL_ERROR";
        readonly status: 500;
        readonly message: "Something went wrong. Please try again.";
        readonly safeForClient: true;
        readonly category: "internal";
    };
    readonly UPSTREAM_ERROR: {
        readonly code: "UPSTREAM_ERROR";
        readonly status: 502;
        readonly message: "Upstream provider error occurred.";
        readonly safeForClient: true;
        readonly category: "upstream";
    };
    readonly SERVICE_UNAVAILABLE: {
        readonly code: "SERVICE_UNAVAILABLE";
        readonly status: 503;
        readonly message: "Service is temporarily unavailable. Please try again later.";
        readonly safeForClient: true;
        readonly category: "upstream";
    };
    readonly UPSTREAM_TIMEOUT: {
        readonly code: "UPSTREAM_TIMEOUT";
        readonly status: 504;
        readonly message: "Upstream connection timed out.";
        readonly safeForClient: true;
        readonly category: "upstream";
    };
};
export type ApiErrorCode = keyof typeof ERROR_CODES;
//# sourceMappingURL=error-codes.d.ts.map