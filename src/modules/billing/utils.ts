// utils.ts - Billing Utilities

import {
  type PlanLimits,
  type PlanFeatures,
  type InvoiceLineItem,
  BillingInterval,
  SubscriptionStatus,
  InvoiceStatus,
  UsageMetricType
} from './types.js';

// ============================================
// DATE UTILITIES
// ============================================

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((date1.getTime() - date2.getTime()) / oneDay));
}

// ============================================
// CALCULATION UTILITIES
// ============================================

export function calculateProration(
  currentPrice: number,
  newPrice: number,
  daysRemaining: number,
  daysInPeriod: number
): { credit: number; charge: number; net: number } {
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

export function calculateTaxAmount(subtotal: number, taxRate: number): number {
  return Math.round(subtotal * (taxRate / 100) * 100) / 100;
}

export function calculateDiscount(
  amount: number,
  discountType: 'percentage' | 'fixed_amount',
  discountValue: number
): number {
  if (discountType === 'percentage') {
    return Math.round(amount * (discountValue / 100) * 100) / 100;
  }
  return Math.min(discountValue, amount);
}

export function calculateMrr(
  basePrice: number,
  interval: BillingInterval
): number {
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

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(amount);
}

export function formatInvoiceNumber(prefix: string | null, number: number): string {
  const prefixStr = prefix ? `${prefix}-` : '';
  return `${prefixStr}${number.toString().padStart(6, '0')}`;
}

export function maskCardNumber(last4: string | null): string {
  if (!last4) return '****';
  return `**** **** **** ${last4}`;
}

// ============================================
// VALIDATION UTILITIES
// ============================================

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidTaxId(taxId: string, country: string): boolean {
  if (country === 'US') {
    return /^\d{2}-\d{7}$/.test(taxId) || /^\d{9}$/.test(taxId);
  }
  if (country === 'EU') {
    return /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(taxId);
  }
  return taxId.length >= 4 && taxId.length <= 20;
}

export function isValidCouponCode(code: string): boolean {
  return /^[A-Z0-9_-]{3,50}$/i.test(code);
}

// ============================================
// PLAN LIMITS UTILITIES
// ============================================

export function getDefaultPlanLimits(): PlanLimits {
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

export function getDefaultPlanFeatures(): PlanFeatures {
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

export function checkLimitExceeded(
  current: number,
  limit: number | null
): { exceeded: boolean; percentage: number; remaining: number } {
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

export function generateLineItems(
  planName: string,
  planPrice: number,
  overages: { description: string; amount: number; quantity: number; unitPrice: number }[] = [],
  discount: { description: string; amount: number } | null = null,
  tax: { description: string; amount: number; rate: number } | null = null
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [
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

export function calculateInvoiceTotals(lineItems: InvoiceLineItem[]): {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
} {
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

export function projectUsage(
  currentUsage: number,
  daysElapsed: number,
  daysInPeriod: number
): number {
  if (daysElapsed === 0) return currentUsage;
  const dailyRate = currentUsage / daysElapsed;
  return Math.round(dailyRate * daysInPeriod);
}

// ============================================
// STRIPE UTILITIES
// ============================================

export function mapStripeStatusToSubscriptionStatus(
  stripeStatus: string
): SubscriptionStatus {
  const statusMap: Record<string, SubscriptionStatus> = {
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

export function mapStripeInvoiceStatus(
  stripeStatus: string
): InvoiceStatus {
  const statusMap: Record<string, InvoiceStatus> = {
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
  public code: string;
  public statusCode: number;
  public details?: any;

  constructor(code: string, message: string, statusCode: number = 400, details?: any) {
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
} as const;

// ============================================
// LOGGING
// ============================================

export function createBillingLogger(context: string) {
  return {
    info: (message: string, meta?: any) => {
      console.log(`[BILLING:${context}] ${message}`, meta ? JSON.stringify(meta) : '');
    },
    error: (message: string, error?: any) => {
      console.error(`[BILLING:${context}:ERROR] ${message}`, error);
    },
    warn: (message: string, meta?: any) => {
      console.warn(`[BILLING:${context}:WARN] ${message}`, meta ? JSON.stringify(meta) : '');
    },
    debug: (message: string, meta?: any) => {
      if (process.env.DEBUG_BILLING === 'true') {
        console.log(`[BILLING:${context}:DEBUG] ${message}`, meta ? JSON.stringify(meta) : '');
      }
    }
  };
}