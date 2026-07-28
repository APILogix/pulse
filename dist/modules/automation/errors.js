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
export class AutomationError extends AppError {
    constructor(message, code, statusCode, details) {
        super(message, code, statusCode, details);
    }
}
export class AutomationNotFoundError extends AutomationError {
    constructor(resource = 'Automation resource') {
        super(`${resource} not found`, 'AUTOMATION_NOT_FOUND', 404);
    }
}
export class AutomationValidationError extends AutomationError {
    constructor(message, details) {
        super(message, 'AUTOMATION_VALIDATION_ERROR', 400, details);
    }
}
export class AutomationConflictError extends AutomationError {
    constructor(message, details) {
        super(message, 'AUTOMATION_CONFLICT', 409, details);
    }
}
export class AutomationEntitlementRequiredError extends AutomationError {
    constructor(featureKey) {
        super(`Entitlement required: ${featureKey}`, 'AUTOMATION_ENTITLEMENT_REQUIRED', 403, { requiredFeatureKey: featureKey });
    }
}
export class AutomationLimitExceededError extends AutomationError {
    constructor(limit, current, max) {
        super(`Limit exceeded: ${limit} (current: ${current}, max: ${max})`, 'AUTOMATION_LIMIT_EXCEEDED', 403, { limit, current, max });
    }
}
export class AutomationDisabledError extends AutomationError {
    constructor(workflowId) {
        super(`Workflow ${workflowId} is disabled`, 'AUTOMATION_DISABLED', 403, { workflowId });
    }
}
export class AutomationApprovalRequiredError extends AutomationError {
    constructor(actionType, riskLevel) {
        super(`Approval required for ${actionType} (risk: ${riskLevel})`, 'AUTOMATION_APPROVAL_REQUIRED', 403, { actionType, riskLevel });
    }
}
export class AutomationApprovalExpiredError extends AutomationError {
    constructor(approvalId) {
        super(`Approval ${approvalId} has expired`, 'AUTOMATION_APPROVAL_EXPIRED', 409, { approvalId });
    }
}
export class AutomationRunNotRetryableError extends AutomationError {
    constructor(runId, reason) {
        super(`Run ${runId} is not retryable: ${reason}`, 'AUTOMATION_RUN_NOT_RETRYABLE', 409, { runId, reason });
    }
}
export class AutomationActionNotSupportedError extends AutomationError {
    constructor(actionType) {
        super(`Action type not supported: ${actionType}`, 'AUTOMATION_ACTION_NOT_SUPPORTED', 422, { actionType });
    }
}
export class AutomationTriggerNotSupportedError extends AutomationError {
    constructor(triggerType) {
        super(`Trigger type not supported: ${triggerType}`, 'AUTOMATION_TRIGGER_NOT_SUPPORTED', 422, { triggerType });
    }
}
export class AutomationIdempotencyConflictError extends AutomationError {
    constructor(key) {
        super(`Idempotency conflict: event with dedupe key already processed`, 'AUTOMATION_IDEMPOTENCY_CONFLICT', 409, { dedupeKey: key });
    }
}
export class AutomationPayloadTooLargeError extends AutomationError {
    constructor(sizeBytes, maxBytes) {
        super(`Payload too large: ${sizeBytes} bytes exceeds maximum of ${maxBytes} bytes`, 'AUTOMATION_PAYLOAD_TOO_LARGE', 400, { sizeBytes, maxBytes });
    }
}
export class AutomationDefinitionError extends AutomationError {
    constructor(message, details) {
        super(message, 'AUTOMATION_VALIDATION_ERROR', 422, details);
    }
}
export class AutomationForbiddenError extends AutomationError {
    constructor(message) {
        super(message, 'AUTOMATION_FORBIDDEN', 403);
    }
}
//# sourceMappingURL=errors.js.map