/**
 * Centralized Error Code Registry for Platform-Wide API Responses.
 *
 * Each error code defines its default machine-readable code, HTTP status,
 * default safe message, client safety flag, and category.
 */
export const ERROR_CODES = {
    // 400 Bad Request / Validation
    VALIDATION_ERROR: {
        code: 'VALIDATION_ERROR',
        status: 400,
        message: 'Please check your input and try again.',
        safeForClient: true,
        category: 'validation',
    },
    INVALID_REQUEST: {
        code: 'INVALID_REQUEST',
        status: 400,
        message: 'The request is invalid or malformed.',
        safeForClient: true,
        category: 'validation',
    },
    INVALID_PARAMETER: {
        code: 'INVALID_PARAMETER',
        status: 400,
        message: 'One or more request parameters are invalid.',
        safeForClient: true,
        category: 'validation',
    },
    // 401 Unauthorized / Authentication
    AUTHENTICATION_REQUIRED: {
        code: 'AUTHENTICATION_REQUIRED',
        status: 401,
        message: 'Authentication is required to access this resource.',
        safeForClient: true,
        category: 'auth',
    },
    INVALID_CREDENTIALS: {
        code: 'INVALID_CREDENTIALS',
        status: 401,
        message: 'Invalid email or password.',
        safeForClient: true,
        category: 'auth',
    },
    INVALID_TOKEN: {
        code: 'INVALID_TOKEN',
        status: 401,
        message: 'Invalid or expired token.',
        safeForClient: true,
        category: 'auth',
    },
    TOKEN_EXPIRED: {
        code: 'TOKEN_EXPIRED',
        status: 401,
        message: 'Your token has expired. Please request a new one.',
        safeForClient: true,
        category: 'auth',
    },
    SESSION_EXPIRED: {
        code: 'SESSION_EXPIRED',
        status: 401,
        message: 'Your session has expired. Please sign in again.',
        safeForClient: true,
        category: 'auth',
    },
    MFA_REQUIRED: {
        code: 'MFA_REQUIRED',
        status: 401,
        message: 'Multi-factor authentication is required.',
        safeForClient: true,
        category: 'auth',
    },
    MFA_INVALID: {
        code: 'MFA_INVALID',
        status: 401,
        message: 'Invalid MFA code.',
        safeForClient: true,
        category: 'auth',
    },
    // 403 Forbidden / Authorization
    FORBIDDEN: {
        code: 'FORBIDDEN',
        status: 403,
        message: 'You do not have permission to perform this action.',
        safeForClient: true,
        category: 'authorization',
    },
    INSUFFICIENT_PERMISSIONS: {
        code: 'INSUFFICIENT_PERMISSIONS',
        status: 403,
        message: 'You do not have permission to perform this action.',
        safeForClient: true,
        category: 'authorization',
    },
    FEATURE_NOT_AVAILABLE: {
        code: 'FEATURE_NOT_AVAILABLE',
        status: 403,
        message: 'This feature is not available on your current plan.',
        safeForClient: true,
        category: 'authorization',
    },
    PLAN_RESTRICTION: {
        code: 'PLAN_RESTRICTION',
        status: 403,
        message: 'Action restricted by your organization subscription plan.',
        safeForClient: true,
        category: 'authorization',
    },
    STEP_UP_REQUIRED: {
        code: 'STEP_UP_REQUIRED',
        status: 403,
        message: 'Additional verification is required to complete this action.',
        safeForClient: true,
        category: 'authorization',
    },
    // 404 Not Found
    NOT_FOUND: {
        code: 'NOT_FOUND',
        status: 404,
        message: 'The requested resource was not found.',
        safeForClient: true,
        category: 'not_found',
    },
    RESOURCE_NOT_FOUND: {
        code: 'RESOURCE_NOT_FOUND',
        status: 404,
        message: 'The requested resource was not found.',
        safeForClient: true,
        category: 'not_found',
    },
    USER_NOT_FOUND: {
        code: 'USER_NOT_FOUND',
        status: 404,
        message: 'User not found.',
        safeForClient: true,
        category: 'not_found',
    },
    PROJECT_NOT_FOUND: {
        code: 'PROJECT_NOT_FOUND',
        status: 404,
        message: 'Project not found.',
        safeForClient: true,
        category: 'not_found',
    },
    ORGANIZATION_NOT_FOUND: {
        code: 'ORGANIZATION_NOT_FOUND',
        status: 404,
        message: 'Organization not found.',
        safeForClient: true,
        category: 'not_found',
    },
    CONNECTOR_NOT_FOUND: {
        code: 'CONNECTOR_NOT_FOUND',
        status: 404,
        message: 'Connector not found.',
        safeForClient: true,
        category: 'not_found',
    },
    // 409 Conflict
    RESOURCE_CONFLICT: {
        code: 'RESOURCE_CONFLICT',
        status: 409,
        message: 'Resource conflict occurred.',
        safeForClient: true,
        category: 'conflict',
    },
    DUPLICATE_RESOURCE: {
        code: 'DUPLICATE_RESOURCE',
        status: 409,
        message: 'A resource with these details already exists.',
        safeForClient: true,
        category: 'conflict',
    },
    RESOURCE_ALREADY_EXISTS: {
        code: 'RESOURCE_ALREADY_EXISTS',
        status: 409,
        message: 'A resource with these details already exists.',
        safeForClient: true,
        category: 'conflict',
    },
    QUOTA_CONFLICT: {
        code: 'QUOTA_CONFLICT',
        status: 409,
        message: 'Conflict with existing resource quota.',
        safeForClient: true,
        category: 'conflict',
    },
    // 422 Business Rule / Semantic
    BUSINESS_RULE_VIOLATION: {
        code: 'BUSINESS_RULE_VIOLATION',
        status: 422,
        message: 'Operation violates application business rules.',
        safeForClient: true,
        category: 'business_rule',
    },
    INVALID_STATE_TRANSITION: {
        code: 'INVALID_STATE_TRANSITION',
        status: 422,
        message: 'Operation is not allowed in the current resource state.',
        safeForClient: true,
        category: 'business_rule',
    },
    UNPROCESSABLE_ENTITY: {
        code: 'UNPROCESSABLE_ENTITY',
        status: 422,
        message: 'Unprocessable entity.',
        safeForClient: true,
        category: 'business_rule',
    },
    // 429 Rate Limit / Quota
    RATE_LIMIT_EXCEEDED: {
        code: 'RATE_LIMIT_EXCEEDED',
        status: 429,
        message: 'Too many requests. Please try again shortly.',
        safeForClient: true,
        category: 'rate_limit',
    },
    QUOTA_EXCEEDED: {
        code: 'QUOTA_EXCEEDED',
        status: 429,
        message: 'You have reached your resource quota for your current plan.',
        safeForClient: true,
        category: 'rate_limit',
    },
    AI_CREDITS_EXHAUSTED: {
        code: 'AI_CREDITS_EXHAUSTED',
        status: 429,
        message: 'AI intelligence credits exhausted for current billing period.',
        safeForClient: true,
        category: 'rate_limit',
    },
    // 500 Internal Error
    INTERNAL_ERROR: {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Something went wrong. Please try again.',
        safeForClient: true,
        category: 'internal',
    },
    // 502 Upstream Error
    UPSTREAM_ERROR: {
        code: 'UPSTREAM_ERROR',
        status: 502,
        message: 'Upstream provider error occurred.',
        safeForClient: true,
        category: 'upstream',
    },
    // 503 Service Unavailable
    SERVICE_UNAVAILABLE: {
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'Service is temporarily unavailable. Please try again later.',
        safeForClient: true,
        category: 'upstream',
    },
    // 504 Upstream Timeout
    UPSTREAM_TIMEOUT: {
        code: 'UPSTREAM_TIMEOUT',
        status: 504,
        message: 'Upstream connection timed out.',
        safeForClient: true,
        category: 'upstream',
    },
};
//# sourceMappingURL=error-codes.js.map