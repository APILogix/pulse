// types.ts - Billing Module Types
import { z } from 'zod';
// ============================================
// ENUMS
// ============================================
export var PlanTier;
(function (PlanTier) {
    PlanTier["FREE"] = "free";
    PlanTier["PRO"] = "pro";
    PlanTier["STARTER"] = "free";
    PlanTier["PROFESSIONAL"] = "pro";
    PlanTier["ENTERPRISE"] = "enterprise";
    PlanTier["CUSTOM"] = "custom";
})(PlanTier || (PlanTier = {}));
export var BillingInterval;
(function (BillingInterval) {
    BillingInterval["MONTHLY"] = "monthly";
    BillingInterval["ANNUAL"] = "annual";
    BillingInterval["YEARLY"] = "annual";
    BillingInterval["CUSTOM"] = "custom";
})(BillingInterval || (BillingInterval = {}));
export var SubscriptionStatus;
(function (SubscriptionStatus) {
    SubscriptionStatus["TRIALING"] = "trialing";
    SubscriptionStatus["ACTIVE"] = "active";
    SubscriptionStatus["PAST_DUE"] = "past_due";
    SubscriptionStatus["CANCELED"] = "canceled";
    SubscriptionStatus["UNPAID"] = "unpaid";
    SubscriptionStatus["PAUSED"] = "paused";
})(SubscriptionStatus || (SubscriptionStatus = {}));
export var InvoiceStatus;
(function (InvoiceStatus) {
    InvoiceStatus["DRAFT"] = "draft";
    InvoiceStatus["OPEN"] = "open";
    InvoiceStatus["PAID"] = "paid";
    InvoiceStatus["UNCOLLECTIBLE"] = "uncollectible";
    InvoiceStatus["VOID"] = "void";
})(InvoiceStatus || (InvoiceStatus = {}));
export var PaymentMethodType;
(function (PaymentMethodType) {
    PaymentMethodType["CARD"] = "card";
    PaymentMethodType["BANK_TRANSFER"] = "bank_transfer";
    PaymentMethodType["PAYPAL"] = "paypal";
    PaymentMethodType["CRYPTO"] = "crypto";
    PaymentMethodType["INVOICE"] = "invoice";
})(PaymentMethodType || (PaymentMethodType = {}));
export var UsageMetricType;
(function (UsageMetricType) {
    UsageMetricType["API_REQUESTS"] = "api_requests";
    UsageMetricType["METRICS_INGESTED"] = "metrics_ingested";
    UsageMetricType["STORAGE_GB"] = "storage_gb";
    UsageMetricType["ALERT_NOTIFICATIONS"] = "alert_notifications";
    UsageMetricType["DASHBOARD_VIEWS"] = "dashboard_views";
    UsageMetricType["MEMBERS_ACTIVE"] = "members_active";
    UsageMetricType["PROJECTS_ACTIVE"] = "projects_active";
    UsageMetricType["APPLICATIONS_MONITORED"] = "applications_monitored";
    UsageMetricType["INTEGRATIONS_ACTIVE"] = "integrations_active";
    UsageMetricType["CUSTOM_METRICS"] = "custom_metrics";
})(UsageMetricType || (UsageMetricType = {}));
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
//# sourceMappingURL=types.js.map