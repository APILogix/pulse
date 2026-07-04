import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
export declare enum PlanTier {
    FREE = "free",
    PRO = "pro",
    STARTER = "free",
    PROFESSIONAL = "pro",
    ENTERPRISE = "enterprise",
    CUSTOM = "custom"
}
export declare enum BillingInterval {
    MONTHLY = "monthly",
    ANNUAL = "annual",
    YEARLY = "annual",
    CUSTOM = "custom"
}
export declare enum SubscriptionStatus {
    TRIALING = "trialing",
    ACTIVE = "active",
    PAST_DUE = "past_due",
    CANCELED = "canceled",
    UNPAID = "unpaid",
    PAUSED = "paused"
}
export declare enum InvoiceStatus {
    DRAFT = "draft",
    OPEN = "open",
    PAID = "paid",
    UNCOLLECTIBLE = "uncollectible",
    VOID = "void"
}
export declare enum PaymentMethodType {
    CARD = "card",
    BANK_TRANSFER = "bank_transfer",
    PAYPAL = "paypal",
    CRYPTO = "crypto",
    INVOICE = "invoice"
}
export declare enum UsageMetricType {
    API_REQUESTS = "api_requests",
    METRICS_INGESTED = "metrics_ingested",
    STORAGE_GB = "storage_gb",
    ALERT_NOTIFICATIONS = "alert_notifications",
    DASHBOARD_VIEWS = "dashboard_views",
    MEMBERS_ACTIVE = "members_active",
    PROJECTS_ACTIVE = "projects_active",
    APPLICATIONS_MONITORED = "applications_monitored",
    INTEGRATIONS_ACTIVE = "integrations_active",
    CUSTOM_METRICS = "custom_metrics"
}
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
export type RequestWithUser = AuthenticatedRequest;
export type UpdateBillingSettingsBody = UpdateSettingsBody;
export type QuotaIncreaseBody = QuotaIncreaseRequest;
export type ListInvoicesQuery = ListQueryParams;
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
export declare const BillingUuidSchema: z.ZodString;
export declare const BillingIntervalSchema: z.ZodEnum<{
    monthly: "monthly";
    annual: "annual";
}>;
export declare const InvoiceStatusSchema: z.ZodEnum<{
    void: "void";
    draft: "draft";
    open: "open";
    paid: "paid";
    uncollectible: "uncollectible";
}>;
export declare const UsageMetricTypeSchema: z.ZodEnum<{
    api_requests: "api_requests";
    metrics_ingested: "metrics_ingested";
    storage_gb: "storage_gb";
    alert_notifications: "alert_notifications";
    dashboard_views: "dashboard_views";
    members_active: "members_active";
    projects_active: "projects_active";
    applications_monitored: "applications_monitored";
    integrations_active: "integrations_active";
    custom_metrics: "custom_metrics";
}>;
export declare const PlanIdParamsSchema: z.ZodObject<{
    planId: z.ZodString;
}, z.core.$strip>;
export declare const IdParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const ProviderParamsSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        stripe: "stripe";
        razorpay: "razorpay";
    }>;
}, z.core.$strip>;
export declare const EstimatePricingSchema: z.ZodObject<{
    planId: z.ZodString;
    interval: z.ZodEnum<{
        monthly: "monthly";
        annual: "annual";
    }>;
    couponCode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CreateSubscriptionSchema: z.ZodObject<{
    planId: z.ZodString;
    paymentMethodId: z.ZodOptional<z.ZodString>;
    billingInterval: z.ZodOptional<z.ZodEnum<{
        monthly: "monthly";
        annual: "annual";
    }>>;
    couponCode: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const ChangePlanSchema: z.ZodObject<{
    planId: z.ZodString;
    prorationBehavior: z.ZodOptional<z.ZodEnum<{
        none: "none";
        create_prorations: "create_prorations";
        always_invoice: "always_invoice";
    }>>;
}, z.core.$strip>;
export declare const ChangeIntervalSchema: z.ZodObject<{
    interval: z.ZodEnum<{
        monthly: "monthly";
        annual: "annual";
    }>;
}, z.core.$strip>;
export declare const PreviewChangeSchema: z.ZodObject<{
    newPlanId: z.ZodString;
}, z.core.$strip>;
export declare const CancelSubscriptionSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
    immediate: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const AddPaymentMethodSchema: z.ZodObject<{
    type: z.ZodEnum<typeof PaymentMethodType>;
    stripePaymentMethodId: z.ZodOptional<z.ZodString>;
    paypalEmail: z.ZodOptional<z.ZodString>;
    billingDetails: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, z.core.$strip>;
export declare const ListInvoicesQuerySchema: z.ZodObject<{
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    status: z.ZodOptional<z.ZodEnum<{
        void: "void";
        draft: "draft";
        open: "open";
        paid: "paid";
        uncollectible: "uncollectible";
    }>>;
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const UsageQuerySchema: z.ZodObject<{
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
    granularity: z.ZodOptional<z.ZodEnum<{
        monthly: "monthly";
        hourly: "hourly";
        daily: "daily";
    }>>;
}, z.core.$strip>;
export declare const UsageHistoryQuerySchema: z.ZodObject<{
    type: z.ZodEnum<{
        api_requests: "api_requests";
        metrics_ingested: "metrics_ingested";
        storage_gb: "storage_gb";
        alert_notifications: "alert_notifications";
        dashboard_views: "dashboard_views";
        members_active: "members_active";
        projects_active: "projects_active";
        applications_monitored: "applications_monitored";
        integrations_active: "integrations_active";
        custom_metrics: "custom_metrics";
    }>;
}, z.core.$strip>;
export declare const UsageExportQuerySchema: z.ZodObject<{
    format: z.ZodOptional<z.ZodEnum<{
        csv: "csv";
        json: "json";
    }>>;
}, z.core.$strip>;
export declare const QuotaTypeParamsSchema: z.ZodObject<{
    type: z.ZodEnum<{
        api_requests: "api_requests";
        metrics_ingested: "metrics_ingested";
        storage_gb: "storage_gb";
        alert_notifications: "alert_notifications";
        dashboard_views: "dashboard_views";
        members_active: "members_active";
        projects_active: "projects_active";
        applications_monitored: "applications_monitored";
        integrations_active: "integrations_active";
        custom_metrics: "custom_metrics";
    }>;
}, z.core.$strip>;
export declare const QuotaIncreaseSchema: z.ZodObject<{
    requestedLimit: z.ZodCoercedNumber<unknown>;
    reason: z.ZodString;
}, z.core.$strip>;
export declare const UpdateBillingSettingsSchema: z.ZodObject<{
    billingEmail: z.ZodOptional<z.ZodString>;
    billingAddress: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    taxId: z.ZodOptional<z.ZodString>;
    netTermsDays: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const BillingEmailSchema: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
export declare const BillingAddressSchema: z.ZodObject<{
    address: z.ZodRecord<z.ZodString, z.ZodAny>;
}, z.core.$strip>;
export declare const TaxSettingsSchema: z.ZodObject<{
    taxId: z.ZodString;
}, z.core.$strip>;
export declare const ApplyCouponSchema: z.ZodObject<{
    code: z.ZodString;
}, z.core.$strip>;
export declare const WaiveInvoiceSchema: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strip>;
export declare const CreditsSchema: z.ZodObject<{
    amount: z.ZodCoercedNumber<unknown>;
    reason: z.ZodString;
}, z.core.$strip>;
export declare const CheckoutSessionSchema: z.ZodObject<{
    planId: z.ZodString;
}, z.core.$strip>;
//# sourceMappingURL=types.d.ts.map