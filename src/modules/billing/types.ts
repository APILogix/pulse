// types.ts - Billing Module Types

import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

// ============================================
// ENUMS
// ============================================

export enum PlanTier {
  FREE = 'free',
  PRO = 'pro',
  STARTER = 'free',
  PROFESSIONAL = 'pro',
  ENTERPRISE = 'enterprise',
  CUSTOM = 'custom'
}

export enum BillingInterval {
  MONTHLY = 'monthly',
  ANNUAL = 'annual',
  YEARLY = 'annual',
  CUSTOM = 'custom'
}

export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  UNPAID = 'unpaid',
  PAUSED = 'paused'
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  OPEN = 'open',
  PAID = 'paid',
  UNCOLLECTIBLE = 'uncollectible',
  VOID = 'void'
}

export enum PaymentMethodType {
  CARD = 'card',
  BANK_TRANSFER = 'bank_transfer',
  PAYPAL = 'paypal',
  CRYPTO = 'crypto',
  INVOICE = 'invoice'
}

export enum UsageMetricType {
  API_REQUESTS = 'api_requests',
  METRICS_INGESTED = 'metrics_ingested',
  STORAGE_GB = 'storage_gb',
  ALERT_NOTIFICATIONS = 'alert_notifications',
  DASHBOARD_VIEWS = 'dashboard_views',
  MEMBERS_ACTIVE = 'members_active',
  PROJECTS_ACTIVE = 'projects_active',
  APPLICATIONS_MONITORED = 'applications_monitored',
  INTEGRATIONS_ACTIVE = 'integrations_active',
  CUSTOM_METRICS = 'custom_metrics'
}

// ============================================
// DATABASE MODELS
// ============================================

export interface BillingPlan {
  id: string;
  key?: string;
  version?: number;
  name: string;
  description: string | null;
  tier: PlanTier;
  isPublic: boolean;
  sortOrder: number;
  basePriceMonthly: number;
  basePriceYearly: number | null;
  eventLimitMonthly?: number;
  hardCap?: boolean;
  priceInrMonthly?: number | null;
  priceUsdMonthly?: number | null;
  priceInrAnnual?: number | null;
  priceUsdAnnual?: number | null;
  overagePricePer1kInr?: number | null;
  overagePricePer1kUsd?: number | null;
  featureConfig?: Record<string, any>;
  currency: string;
  billingInterval: BillingInterval;
  limits: PlanLimits;
  features: PlanFeatures;
  trialDays: number;
  gracePeriodDays: number;
  isActive: boolean;
  deprecatedAt: Date | null;
  replacedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanLimits {
  maxProjects: number;
  maxMembers: number;
  maxApplications: number;
  maxMetricsPerApp: number;
  dataRetentionDays: number;
  apiRequestsPerMin: number;
  alertRules: number;
  dashboards: number;
  integrations: number;
  supportLevel: string;
  ssoEnabled: boolean;
  advancedAnalytics: boolean;
  customDomains: number;
  slaUptime: string;
}

export interface PlanFeatures {
  realTimeAlerts: boolean;
  emailNotifications: boolean;
  slackIntegration: boolean;
  pagerdutyIntegration: boolean;
  customWebhooks: boolean;
  logRetentionExtended: boolean;
  auditLogs: boolean;
  dedicatedSupport: boolean;
  customContract: boolean;
}

export interface OrganizationBilling {
  id: string;
  orgId: string;
  planId: string;
  status: SubscriptionStatus;
  billingProvider?: 'stripe' | 'razorpay' | 'manual' | 'system';
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  billingInterval?: BillingInterval;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  seats?: number | null;
  billingCycleAnchor: Date;
  defaultPaymentMethodId: string | null;
  paymentMethodType: PaymentMethodType;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  invoicePrefix: string | null;
  nextInvoiceNumber: number;
  invoiceNotes: string | null;
  netTermsDays: number;
  usageBillingEnabled: boolean;
  overageRatePerUnit: number | null;
  mrr: number;
  arr: number;
  totalPaidToDate: number;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  cancellationReason: string | null;
  gracePeriodStart: Date | null;
  gracePeriodEnd: Date | null;
  taxExempt: boolean;
  taxId: string | null;
  taxRate: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentMethod {
  id: string;
  orgId: string;
  type: PaymentMethodType;
  isDefault: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  bankAccountLast4: string | null;
  bankName: string | null;
  stripePaymentMethodId: string | null;
  paypalEmail: string | null;
  billingDetails: Record<string, any> | null;
  isActive: boolean;
  createdAt: Date;
}

export interface Invoice {
  id: string;
  orgId: string;
  subscriptionId?: string;
  provider?: 'stripe' | 'razorpay' | 'manual' | 'system';
  providerInvoiceId?: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  invoiceDate: Date;
  dueDate: Date;
  paidAt: Date | null;
  periodStart: Date;
  periodEnd: Date;
  subtotal: number;
  discountAmount: number;
  discountCode: string | null;
  taxAmount: number;
  taxRate: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  lineItems: InvoiceLineItem[];
  paymentMethod: PaymentMethodType | null;
  paymentIntentId: string | null;
  stripeInvoiceId: string | null;
  pdfUrl: string | null;
  overageEvents?: number;
  overageAmount?: number;
  footerNote: string | null;
  memo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceLineItem {
  description: string;
  amount: number;
  quantity: number;
  unitPrice: number;
  type: 'plan' | 'overage' | 'addon' | 'discount' | 'tax';
  metadata?: Record<string, any>;
}

export interface UsageRecord {
  id: string;
  orgId: string;
  projectId?: string;
  metricType: UsageMetricType;
  metricName: string;
  periodStart: Date;
  periodEnd: Date;
  granularity: 'hourly' | 'daily' | 'monthly';
  usageCount: number;
  usageLimit: number | null;
  overageCount: number;
  unitCost: number | null;
  totalCost: number;
  details: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageCounter {
  orgId: string;
  currentPeriodStart: Date;
  apiRequestsThisPeriod: number;
  metricsIngestedThisPeriod: number;
  aiAnalysesThisPeriod?: number;
  storageGbThisPeriod: number;
  notificationsSentThisPeriod: number;
  totalApiRequestsAllTime: number;
  totalMetricsIngestedAllTime: number;
  lastUpdatedAt: Date;
  limitWarning80SentAt: Date | null;
  limitWarning100SentAt: Date | null;
  updatedAt: Date;
}

export interface QuotaRequest {
  id: string;
  orgId: string;
  quotaType: UsageMetricType;
  requestedLimit: number;
  currentLimit: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: Date | null;
  notes: string | null;
  createdAt: Date;
}

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discountType: 'percentage' | 'fixed_amount' | 'percent' | 'fixed';
  discountValue: number;
  currency: string | null;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths: number | null;
  maxRedemptions: number | null;
  redeemBy: Date | null;
  timesRedeemed: number;
  redemptionCount?: number;
  validFrom?: Date;
  validUntil?: Date | null;
  isActive: boolean;
  createdAt: Date;
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

export interface CreateSubscriptionRequest {
  planId: string;
  paymentMethodId?: string;
  billingInterval?: BillingInterval;
  couponCode?: string;
  taxId?: string;
}

export interface ChangePlanRequest {
  planId: string;
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
}

export interface CancelSubscriptionRequest {
  reason?: string;
  feedback?: string;
  immediate?: boolean;
}

export interface AddPaymentMethodRequest {
  type: PaymentMethodType;
  stripePaymentMethodId?: string;
  paypalEmail?: string;
  billingDetails?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
    };
  };
}

export interface UpdateBillingSettingsRequest {
  billingEmail?: string;
  billingName?: string;
  billingAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    vatId?: string;
  };
  invoiceNotes?: string;
  netTermsDays?: number;
}

export interface ApplyCouponRequest {
  code: string;
}

export interface UsageQueryRequest {
  startDate?: string;
  endDate?: string;
  granularity?: 'hourly' | 'daily' | 'monthly';
  metricTypes?: UsageMetricType[];
}

export interface QuotaIncreaseRequest {
  requestedLimit: number;
  reason: string;
}

// ============================================
// SERVICE RESPONSE TYPES
// ============================================

export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

export interface PlanComparison {
  plans: BillingPlan[];
  differences: {
    feature: string;
    values: Record<string, boolean | number | string>;
  }[];
}

export interface PricingEstimate {
  planId: string;
  interval: BillingInterval;
  basePrice: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  currency: string;
  breakdown: {
    description: string;
    amount: number;
  }[];
}

export interface UsageSummary {
  orgId: string;
  periodStart: Date;
  periodEnd: Date;
  metrics: {
    type: UsageMetricType;
    name: string;
    used: number;
    limit: number | null;
    percentage: number;
    overage: number;
    projected: number;
  }[];
  totalCost: number;
  lastUpdated: Date;
}

export interface UsageOverview {
  orgId: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  summary: {
    todayEvents: number;
    monthToDateEvents: number;
    eventLimitMonthly: number | null;
    remainingEvents: number | null;
    percentUsed: number;
    projectedMonthEndEvents: number;
  };
  metrics: UsageSummary['metrics'];
  activity: {
    date: Date;
    events: number;
    aiAnalyses: number;
  }[];
}

export interface SubscriptionPreview {
  currentPlan: BillingPlan;
  newPlan: BillingPlan;
  prorationDate: Date;
  creditBalance: number;
  newCharges: number;
  amountDue: number;
  nextBillingDate: Date;
  currency: string;
}

// ============================================
// FASTIFY REQUEST TYPES
// ============================================

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    id: string;
    email: string;
    isAdmin: boolean;
    sessionId: string;
    mfaVerified: boolean;
    stepUpFresh: boolean;
    orgId?: string;
  };
}

export interface CreateSubscriptionBody {
  planId: string;
  paymentMethodId?: string;
  billingInterval?: BillingInterval;
  couponCode?: string;
}

export interface ChangePlanBody {
  planId: string;
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
}

export interface CancelSubscriptionBody {
  reason?: string;
  immediate?: boolean;
}

export interface AddPaymentMethodBody {
  type: PaymentMethodType;
  stripePaymentMethodId?: string;
  paypalEmail?: string;
  billingDetails?: Record<string, any>;
}

export interface UpdateSettingsBody {
  billingEmail?: string;
  billingAddress?: Record<string, any>;
  taxId?: string;
  netTermsDays?: number;
}

export interface ApplyCouponBody {
  code: string;
}

export interface UsageQueryParams {
  startDate?: string;
  endDate?: string;
  granularity?: 'hourly' | 'daily' | 'monthly';
}

export interface ListQueryParams {
  page?: number;
  limit?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
}

// Backward-compatible aliases used by routes/service
export type RequestWithUser = AuthenticatedRequest;
export type UpdateBillingSettingsBody = UpdateSettingsBody;
export type QuotaIncreaseBody = QuotaIncreaseRequest;
export type ListInvoicesQuery = ListQueryParams;

// ============================================
// WEBHOOK TYPES
// ============================================

export interface StripeWebhookEvent {
  id: string;
  object: string;
  api_version: string;
  created: number;
  livemode: boolean;
  pending_webhooks: number;
  request: {
    id: string | null;
    idempotency_key: string | null;
  };
  type: string;
  data: {
    object: any;
  };
}

export interface WebhookHandlerResponse {
  received: boolean;
  processed: boolean;
  eventId: string;
}

// ============================================
// RUNTIME VALIDATION SCHEMAS
// ============================================

export const BillingUuidSchema = z.string().uuid();
export const BillingIntervalSchema = z.enum(['monthly', 'annual']);
export const InvoiceStatusSchema = z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']);
export const UsageMetricTypeSchema = z.enum([
  'api_requests',
  'metrics_ingested',
  'storage_gb',
  'alert_notifications',
  'dashboard_views',
  'members_active',
  'projects_active',
  'applications_monitored',
  'integrations_active',
  'custom_metrics',
]);

const DateStringSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'Invalid date',
});

export const PlanIdParamsSchema = z.object({ planId: BillingUuidSchema });
export const IdParamsSchema = z.object({ id: BillingUuidSchema });
export const ProviderParamsSchema = z.object({ provider: z.enum(['stripe', 'razorpay']) });

export const EstimatePricingSchema = z.object({
  planId: BillingUuidSchema,
  interval: BillingIntervalSchema,
  couponCode: z.string().trim().min(3).max(30).optional(),
});

export const CreateSubscriptionSchema = z.object({
  planId: BillingUuidSchema,
  paymentMethodId: z.string().trim().min(1).max(200).optional(),
  billingInterval: BillingIntervalSchema.optional(),
  couponCode: z.string().trim().min(3).max(30).optional(),
});

export const ChangePlanSchema = z.object({
  planId: BillingUuidSchema,
  prorationBehavior: z.enum(['create_prorations', 'none', 'always_invoice']).optional(),
});

export const ChangeIntervalSchema = z.object({
  interval: BillingIntervalSchema,
});

export const PreviewChangeSchema = z.object({ newPlanId: BillingUuidSchema });

export const CancelSubscriptionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  immediate: z.boolean().optional(),
});

export const AddPaymentMethodSchema = z.object({
  type: z.nativeEnum(PaymentMethodType),
  stripePaymentMethodId: z.string().trim().max(200).optional(),
  paypalEmail: z.string().email().optional(),
  billingDetails: z.record(z.string(), z.any()).optional(),
});

export const ListInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: InvoiceStatusSchema.optional(),
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
});

export const UsageQuerySchema = z.object({
  startDate: DateStringSchema.optional(),
  endDate: DateStringSchema.optional(),
  granularity: z.enum(['hourly', 'daily', 'monthly']).optional(),
});

export const UsageHistoryQuerySchema = z.object({ type: UsageMetricTypeSchema });

export const UsageExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).optional(),
});

export const QuotaTypeParamsSchema = z.object({ type: UsageMetricTypeSchema });
export const QuotaIncreaseSchema = z.object({
  requestedLimit: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(1000),
});

export const UpdateBillingSettingsSchema = z.object({
  billingEmail: z.string().email().optional(),
  billingAddress: z.record(z.string(), z.any()).optional(),
  taxId: z.string().trim().min(4).max(50).optional(),
  netTermsDays: z.coerce.number().int().min(0).max(120).optional(),
});

export const BillingEmailSchema = z.object({ email: z.string().email() });
export const BillingAddressSchema = z.object({ address: z.record(z.string(), z.any()) });
export const TaxSettingsSchema = z.object({ taxId: z.string().trim().min(4).max(50) });
export const ApplyCouponSchema = z.object({ code: z.string().trim().min(3).max(30) });
export const WaiveInvoiceSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const CreditsSchema = z.object({
  amount: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
});
export const CheckoutSessionSchema = z.object({ planId: BillingUuidSchema });
