// errors.ts - Shared Billing Errors

export class BillingError extends Error {
  public code: string;
  public details?: any;
  public statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400, details?: any) {
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
  INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  COUPON_INVALID: 'COUPON_INVALID',
  COUPON_EXPIRED: 'COUPON_EXPIRED',
  COUPON_LIMIT_REACHED: 'COUPON_LIMIT_REACHED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED'
} as const;

export function handleBillingError(error: unknown, reply: any) {
  if (error instanceof BillingError) {
    return reply.code(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  // Handle Zod validation errors if needed, but usually Fastify handles them if schema is passed
  // Or handle fastify errors

  console.error('[Billing Module Error]', error);
  return reply.code(500).send({
    success: false,
    error: {
      code: BillingErrorCodes.INTERNAL_ERROR,
      message: 'An unexpected error occurred during the billing operation',
    },
  });
}
