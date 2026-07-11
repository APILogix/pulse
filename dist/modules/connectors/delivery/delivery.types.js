import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { ConnectorError } from '../core/connector.types.js';
export const DeliveryStatusSchema = z.enum([
    'pending',
    'sent',
    'delivered',
    'failed',
    'retrying',
    'cancelled',
]);
export const FailureCategorySchema = z.enum([
    'timeout',
    'auth_error',
    'rate_limit',
    'invalid_config',
    'invalid_payload',
    'network_error',
    'circuit_open',
    'unknown',
]);
export class ConnectorDeliveryError extends ConnectorError {
    failureCategory;
    retryable;
    constructor(message, failureCategory, retryable, details) {
        super(message, 'CONNECTOR_DELIVERY_FAILED', 502, details);
        this.failureCategory = failureCategory;
        this.retryable = retryable;
    }
}
//# sourceMappingURL=delivery.types.js.map