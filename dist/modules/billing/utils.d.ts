/**
 * Billing utility functions.
 *
 * Flow:
 * - Date helpers define billing periods and report windows.
 * - Calculation helpers produce proration, tax, discounts, MRR, limits, and
 *   invoice totals.
 * - Mapping helpers translate provider statuses into local billing enums.
 * - BillingError and logger helpers standardize route/service error handling
 *   and diagnostics.
 */
import { type PlanLimits, type PlanFeatures, type InvoiceLineItem, BillingInterval, SubscriptionStatus, InvoiceStatus } from './types.js';
export declare function addDays(date: Date, days: number): Date;
export declare function addMonths(date: Date, months: number): Date;
export declare function startOfDay(date: Date): Date;
export declare function endOfDay(date: Date): Date;
export declare function startOfMonth(date: Date): Date;
export declare function endOfMonth(date: Date): Date;
export declare function daysBetween(date1: Date, date2: Date): number;
export declare function calculateProration(currentPrice: number, newPrice: number, daysRemaining: number, daysInPeriod: number): {
    credit: number;
    charge: number;
    net: number;
};
export declare function calculateTaxAmount(subtotal: number, taxRate: number): number;
export declare function calculateDiscount(amount: number, discountType: 'percentage' | 'fixed_amount' | 'percent' | 'fixed', discountValue: number): number;
export declare function calculateMrr(basePrice: number, interval: BillingInterval): number;
export declare function formatCurrency(amount: number, currency?: string): string;
export declare function formatInvoiceNumber(prefix: string | null, number: number): string;
export declare function maskCardNumber(last4: string | null): string;
export declare function isValidEmail(email: string): boolean;
export declare function isValidTaxId(taxId: string, country: string): boolean;
export declare function isValidCouponCode(code: string): boolean;
export declare function getDefaultPlanLimits(): PlanLimits;
export declare function getDefaultPlanFeatures(): PlanFeatures;
export declare function checkLimitExceeded(current: number, limit: number | null): {
    exceeded: boolean;
    percentage: number;
    remaining: number;
};
export declare function generateLineItems(planName: string, planPrice: number, overages?: {
    description: string;
    amount: number;
    quantity: number;
    unitPrice: number;
}[], discount?: {
    description: string;
    amount: number;
} | null, tax?: {
    description: string;
    amount: number;
    rate: number;
} | null): InvoiceLineItem[];
export declare function calculateInvoiceTotals(lineItems: InvoiceLineItem[]): {
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
};
export declare function projectUsage(currentUsage: number, daysElapsed: number, daysInPeriod: number): number;
export declare function mapStripeStatusToSubscriptionStatus(stripeStatus: string): SubscriptionStatus;
export declare function mapStripeInvoiceStatus(stripeStatus: string): InvoiceStatus;
export declare class BillingError extends Error {
    code: string;
    statusCode: number;
    details?: any;
    constructor(code: string, message: string, statusCode?: number, details?: any);
}
export declare const BillingErrorCodes: {
    readonly PLAN_NOT_FOUND: "PLAN_NOT_FOUND";
    readonly SUBSCRIPTION_NOT_FOUND: "SUBSCRIPTION_NOT_FOUND";
    readonly PAYMENT_METHOD_NOT_FOUND: "PAYMENT_METHOD_NOT_FOUND";
    readonly INVOICE_NOT_FOUND: "INVOICE_NOT_FOUND";
    readonly INVALID_PLAN_CHANGE: "INVALID_PLAN_CHANGE";
    readonly PAYMENT_FAILED: "PAYMENT_FAILED";
    readonly COUPON_INVALID: "COUPON_INVALID";
    readonly COUPON_EXPIRED: "COUPON_EXPIRED";
    readonly QUOTA_EXCEEDED: "QUOTA_EXCEEDED";
    readonly BILLING_ERROR: "BILLING_ERROR";
    readonly UNAUTHORIZED: "UNAUTHORIZED";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
};
export declare function createBillingLogger(context: string): {
    info: (message: string, meta?: any) => void;
    error: (message: string, error?: any) => void;
    warn: (message: string, meta?: any) => void;
    debug: (message: string, meta?: any) => void;
};
//# sourceMappingURL=utils.d.ts.map