/**
 * Automation module – domain errors.
 *
 * All extend AppError for consistent Fastify error mapping.
 * HTTP code mapping:
 *   400 validation
 *   403 entitlement/permission
 *   404 not found
 *   409 conflict/idempotency
 *   422 invalid workflow definition
 *   429 rate limited
 */
import { AppError } from '../../shared/errors/app-error.js';
export declare class AutomationError extends AppError {
    constructor(message: string, code: string, statusCode: number, details?: Record<string, unknown>);
}
export declare class AutomationNotFoundError extends AutomationError {
    constructor(resource?: string);
}
export declare class AutomationValidationError extends AutomationError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class AutomationConflictError extends AutomationError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class AutomationEntitlementRequiredError extends AutomationError {
    constructor(featureKey: string);
}
export declare class AutomationLimitExceededError extends AutomationError {
    constructor(limit: string, current: number, max: number);
}
export declare class AutomationDisabledError extends AutomationError {
    constructor(workflowId: string);
}
export declare class AutomationApprovalRequiredError extends AutomationError {
    constructor(actionType: string, riskLevel: string);
}
export declare class AutomationApprovalExpiredError extends AutomationError {
    constructor(approvalId: string);
}
export declare class AutomationRunNotRetryableError extends AutomationError {
    constructor(runId: string, reason: string);
}
export declare class AutomationActionNotSupportedError extends AutomationError {
    constructor(actionType: string);
}
export declare class AutomationTriggerNotSupportedError extends AutomationError {
    constructor(triggerType: string);
}
export declare class AutomationIdempotencyConflictError extends AutomationError {
    constructor(key: string);
}
export declare class AutomationPayloadTooLargeError extends AutomationError {
    constructor(sizeBytes: number, maxBytes: number);
}
export declare class AutomationDefinitionError extends AutomationError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class AutomationForbiddenError extends AutomationError {
    constructor(message: string);
}
//# sourceMappingURL=errors.d.ts.map