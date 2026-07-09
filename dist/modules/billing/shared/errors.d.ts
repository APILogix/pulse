export declare class BillingError extends Error {
    code: string;
    details?: any;
    statusCode: number;
    constructor(message: string, code: string, statusCode?: number, details?: any);
}
export declare const BillingErrorCodes: {
    readonly PLAN_NOT_FOUND: "PLAN_NOT_FOUND";
    readonly FEATURE_NOT_FOUND: "FEATURE_NOT_FOUND";
    readonly INVALID_SUBSCRIPTION_STATE: "INVALID_SUBSCRIPTION_STATE";
    readonly SUBSCRIPTION_NOT_FOUND: "SUBSCRIPTION_NOT_FOUND";
    readonly PAYMENT_METHOD_NOT_FOUND: "PAYMENT_METHOD_NOT_FOUND";
    readonly INVOICE_NOT_FOUND: "INVOICE_NOT_FOUND";
    readonly INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS";
    readonly COUPON_INVALID: "COUPON_INVALID";
    readonly COUPON_EXPIRED: "COUPON_EXPIRED";
    readonly COUPON_LIMIT_REACHED: "COUPON_LIMIT_REACHED";
    readonly PROVIDER_ERROR: "PROVIDER_ERROR";
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
    readonly UNAUTHORIZED: "UNAUTHORIZED";
};
export declare function handleBillingError(error: unknown, reply: any): any;
//# sourceMappingURL=errors.d.ts.map