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
import { BillingInterval, SubscriptionStatus, InvoiceStatus, UsageMetricType } from './types.js';
// ============================================
// DATE UTILITIES
// ============================================
export function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
export function addMonths(date, months) {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
}
export function startOfDay(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}
export function endOfDay(date) {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
}
export function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}
export function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}
export function daysBetween(date1, date2) {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round(Math.abs((date1.getTime() - date2.getTime()) / oneDay));
}
// ============================================
// CALCULATION UTILITIES
// ============================================
export function calculateProration(currentPrice, newPrice, daysRemaining, daysInPeriod) {
    // Proration credits unused current-plan time and charges remaining new-plan
    // time using daily rates from the current billing period.
    const dailyCurrentRate = currentPrice / daysInPeriod;
    const dailyNewRate = newPrice / daysInPeriod;
    const unusedCredit = dailyCurrentRate * daysRemaining;
    const remainingCharge = dailyNewRate * daysRemaining;
    const credit = Math.max(0, unusedCredit);
    const charge = Math.max(0, remainingCharge);
    const net = charge - credit;
    return {
        credit: Math.round(credit * 100) / 100,
        charge: Math.round(charge * 100) / 100,
        net: Math.round(net * 100) / 100
    };
}
export function calculateTaxAmount(subtotal, taxRate) {
    return Math.round(subtotal * (taxRate / 100) * 100) / 100;
}
export function calculateDiscount(amount, discountType, discountValue) {
    if (discountType === 'percentage' || discountType === 'percent') {
        return Math.round(amount * (discountValue / 100) * 100) / 100;
    }
    return Math.min(discountValue, amount);
}
export function calculateMrr(basePrice, interval) {
    switch (interval) {
        case BillingInterval.MONTHLY:
            return basePrice;
        case BillingInterval.YEARLY:
            return basePrice / 12;
        default:
            return basePrice;
    }
}
// ============================================
// FORMATTING UTILITIES
// ============================================
export function formatCurrency(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency.toUpperCase()
    }).format(amount);
}
export function formatInvoiceNumber(prefix, number) {
    const prefixStr = prefix ? `${prefix}-` : '';
    return `${prefixStr}${number.toString().padStart(6, '0')}`;
}
export function maskCardNumber(last4) {
    if (!last4)
        return '****';
    return `**** **** **** ${last4}`;
}
// ============================================
// VALIDATION UTILITIES
// ============================================
export function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
export function isValidTaxId(taxId, country) {
    if (country === 'US') {
        return /^\d{2}-\d{7}$/.test(taxId) || /^\d{9}$/.test(taxId);
    }
    if (country === 'EU') {
        return /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(taxId);
    }
    return taxId.length >= 4 && taxId.length <= 20;
}
export function isValidCouponCode(code) {
    return /^[A-Z0-9_-]{3,50}$/i.test(code);
}
// ============================================
// PLAN LIMITS UTILITIES
// ============================================
export function getDefaultPlanLimits() {
    return {
        maxProjects: 3,
        maxMembers: 2,
        maxApplications: 5,
        maxMetricsPerApp: 50,
        dataRetentionDays: 7,
        apiRequestsPerMin: 100,
        alertRules: 3,
        dashboards: 1,
        integrations: 1,
        supportLevel: 'community',
        ssoEnabled: false,
        advancedAnalytics: false,
        customDomains: 0,
        slaUptime: '99.0%'
    };
}
export function getDefaultPlanFeatures() {
    return {
        realTimeAlerts: true,
        emailNotifications: true,
        slackIntegration: false,
        pagerdutyIntegration: false,
        customWebhooks: false,
        logRetentionExtended: false,
        auditLogs: false,
        dedicatedSupport: false,
        customContract: false
    };
}
export function checkLimitExceeded(current, limit) {
    // Null limit means unlimited for the current plan/metric.
    if (limit === null) {
        return { exceeded: false, percentage: 0, remaining: Infinity };
    }
    const percentage = (current / limit) * 100;
    const remaining = Math.max(0, limit - current);
    const exceeded = current > limit;
    return {
        exceeded,
        percentage: Math.round(percentage * 100) / 100,
        remaining
    };
}
// ============================================
// INVOICE UTILITIES
// ============================================
export function generateLineItems(planName, planPrice, overages = [], discount = null, tax = null) {
    // Build invoice rows in display order: base plan, overages, discount, then
    // tax. Totals are calculated separately from this normalized list.
    const items = [
        {
            description: `${planName} - Subscription`,
            amount: planPrice,
            quantity: 1,
            unitPrice: planPrice,
            type: 'plan'
        }
    ];
    overages.forEach(overage => {
        items.push({
            description: overage.description,
            amount: overage.amount,
            quantity: overage.quantity,
            unitPrice: overage.unitPrice,
            type: 'overage'
        });
    });
    if (discount && discount.amount > 0) {
        items.push({
            description: discount.description,
            amount: -discount.amount,
            quantity: 1,
            unitPrice: -discount.amount,
            type: 'discount'
        });
    }
    if (tax && tax.amount > 0) {
        items.push({
            description: tax.description,
            amount: tax.amount,
            quantity: 1,
            unitPrice: tax.amount,
            type: 'tax'
        });
    }
    return items;
}
export function calculateInvoiceTotals(lineItems) {
    // Totals are derived from line item types so invoice generation can add new
    // lines without duplicating subtotal/discount/tax math.
    const subtotal = lineItems
        .filter(item => item.type === 'plan' || item.type === 'overage')
        .reduce((sum, item) => sum + item.amount, 0);
    const discount = Math.abs(lineItems
        .filter(item => item.type === 'discount')
        .reduce((sum, item) => sum + item.amount, 0));
    const tax = lineItems
        .filter(item => item.type === 'tax')
        .reduce((sum, item) => sum + item.amount, 0);
    const total = subtotal - discount + tax;
    return {
        subtotal: Math.round(subtotal * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        total: Math.round(total * 100) / 100
    };
}
// ============================================
// USAGE UTILITIES
// ============================================
export function projectUsage(currentUsage, daysElapsed, daysInPeriod) {
    // Simple linear projection based on current burn rate across the billing
    // period.
    if (daysElapsed === 0)
        return currentUsage;
    const dailyRate = currentUsage / daysElapsed;
    return Math.round(dailyRate * daysInPeriod);
}
// ============================================
// STRIPE UTILITIES
// ============================================
export function mapStripeStatusToSubscriptionStatus(stripeStatus) {
    const statusMap = {
        'trialing': SubscriptionStatus.TRIALING,
        'active': SubscriptionStatus.ACTIVE,
        'past_due': SubscriptionStatus.PAST_DUE,
        'canceled': SubscriptionStatus.CANCELED,
        'unpaid': SubscriptionStatus.UNPAID,
        'paused': SubscriptionStatus.PAUSED,
        'incomplete': SubscriptionStatus.TRIALING,
        'incomplete_expired': SubscriptionStatus.CANCELED
    };
    return statusMap[stripeStatus] || SubscriptionStatus.ACTIVE;
}
export function mapStripeInvoiceStatus(stripeStatus) {
    const statusMap = {
        'draft': InvoiceStatus.DRAFT,
        'open': InvoiceStatus.OPEN,
        'paid': InvoiceStatus.PAID,
        'uncollectible': InvoiceStatus.UNCOLLECTIBLE,
        'void': InvoiceStatus.VOID
    };
    return statusMap[stripeStatus] || InvoiceStatus.DRAFT;
}
// ============================================
// ERROR HANDLING
// ============================================
export class BillingError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, statusCode = 400, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'BillingError';
    }
}
export const BillingErrorCodes = {
    PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
    SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
    PAYMENT_METHOD_NOT_FOUND: 'PAYMENT_METHOD_NOT_FOUND',
    INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
    INVALID_PLAN_CHANGE: 'INVALID_PLAN_CHANGE',
    PAYMENT_FAILED: 'PAYMENT_FAILED',
    COUPON_INVALID: 'COUPON_INVALID',
    COUPON_EXPIRED: 'COUPON_EXPIRED',
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    BILLING_ERROR: 'BILLING_ERROR',
    UNAUTHORIZED: 'UNAUTHORIZED',
    VALIDATION_ERROR: 'VALIDATION_ERROR'
};
// ============================================
// LOGGING
// ============================================
export function createBillingLogger(context) {
    return {
        info: (message, meta) => {
            console.log(`[BILLING:${context}] ${message}`, meta ? JSON.stringify(meta) : '');
        },
        error: (message, error) => {
            console.error(`[BILLING:${context}:ERROR] ${message}`, error);
        },
        warn: (message, meta) => {
            console.warn(`[BILLING:${context}:WARN] ${message}`, meta ? JSON.stringify(meta) : '');
        },
        debug: (message, meta) => {
            if (process.env.DEBUG_BILLING === 'true') {
                console.log(`[BILLING:${context}:DEBUG] ${message}`, meta ? JSON.stringify(meta) : '');
            }
        }
    };
}
//# sourceMappingURL=utils.js.map