import { errorResponse } from '../../../shared/http/response.js';
export class BillingError extends Error {
    code;
    details;
    statusCode;
    constructor(message, code, statusCode = 400, details) {
        super(message);
        this.name = 'BillingError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        Object.setPrototypeOf(this, BillingError.prototype);
    }
}
export const BillingErrorCodes = {
    PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
    FEATURE_NOT_FOUND: 'FEATURE_NOT_FOUND',
    INVALID_SUBSCRIPTION_STATE: 'INVALID_SUBSCRIPTION_STATE',
    SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
    PAYMENT_METHOD_NOT_FOUND: 'PAYMENT_METHOD_NOT_FOUND',
    ADDON_NOT_FOUND: 'ADDON_NOT_FOUND',
    INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
    INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
    COUPON_INVALID: 'COUPON_INVALID',
    COUPON_EXPIRED: 'COUPON_EXPIRED',
    COUPON_LIMIT_REACHED: 'COUPON_LIMIT_REACHED',
    PROVIDER_ERROR: 'PROVIDER_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    UNAUTHORIZED: 'UNAUTHORIZED'
};
export function handleBillingError(error, reply) {
    if (error instanceof BillingError) {
        return errorResponse(reply, error.code, error.message, error.statusCode, error.details);
    }
    console.error('[Billing Module Error]', error);
    return errorResponse(reply, BillingErrorCodes.INTERNAL_ERROR, 'An unexpected error occurred during the billing operation', 500);
}
//# sourceMappingURL=errors.js.map