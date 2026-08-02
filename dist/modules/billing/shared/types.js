// types.ts - Shared Billing Module Types
import { z } from 'zod';
// ============================================
// ENUMS (matching DB schema)
// ============================================
export var PlanTier;
(function (PlanTier) {
    PlanTier["FREE"] = "free";
    PlanTier["STARTER"] = "starter";
    PlanTier["GROWTH"] = "growth";
    PlanTier["BUSINESS"] = "business";
    PlanTier["ENTERPRISE"] = "enterprise";
})(PlanTier || (PlanTier = {}));
export var SubscriptionStatus;
(function (SubscriptionStatus) {
    SubscriptionStatus["TRIALING"] = "trialing";
    SubscriptionStatus["ACTIVE"] = "active";
    SubscriptionStatus["PAST_DUE"] = "past_due";
    SubscriptionStatus["PAUSED"] = "paused";
    SubscriptionStatus["CANCELLED"] = "cancelled";
    SubscriptionStatus["EXPIRED"] = "expired";
    SubscriptionStatus["INCOMPLETE"] = "incomplete";
})(SubscriptionStatus || (SubscriptionStatus = {}));
export var BillingProvider;
(function (BillingProvider) {
    BillingProvider["STRIPE"] = "stripe";
    BillingProvider["RAZORPAY"] = "razorpay";
    BillingProvider["MANUAL"] = "manual";
    BillingProvider["SYSTEM"] = "system";
})(BillingProvider || (BillingProvider = {}));
export var BillingInterval;
(function (BillingInterval) {
    BillingInterval["MONTHLY"] = "monthly";
    BillingInterval["ANNUAL"] = "annual";
})(BillingInterval || (BillingInterval = {}));
export var InvoiceStatus;
(function (InvoiceStatus) {
    InvoiceStatus["DRAFT"] = "draft";
    InvoiceStatus["OPEN"] = "open";
    InvoiceStatus["PAID"] = "paid";
    InvoiceStatus["VOID"] = "void";
    InvoiceStatus["UNCOLLECTIBLE"] = "uncollectible";
    InvoiceStatus["REFUNDED"] = "refunded";
})(InvoiceStatus || (InvoiceStatus = {}));
export var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["PENDING"] = "pending";
    PaymentStatus["PROCESSING"] = "processing";
    PaymentStatus["SUCCEEDED"] = "succeeded";
    PaymentStatus["FAILED"] = "failed";
    PaymentStatus["CANCELLED"] = "cancelled";
    PaymentStatus["REFUNDED"] = "refunded";
})(PaymentStatus || (PaymentStatus = {}));
export var CouponDiscountType;
(function (CouponDiscountType) {
    CouponDiscountType["PERCENTAGE"] = "percentage";
    CouponDiscountType["FIXED_AMOUNT"] = "fixed_amount";
})(CouponDiscountType || (CouponDiscountType = {}));
export var FeatureValueType;
(function (FeatureValueType) {
    FeatureValueType["BOOLEAN"] = "boolean";
    FeatureValueType["INTEGER"] = "integer";
    FeatureValueType["DECIMAL"] = "decimal";
    FeatureValueType["STRING"] = "string";
})(FeatureValueType || (FeatureValueType = {}));
export var FeatureCategory;
(function (FeatureCategory) {
    FeatureCategory["MONITORING"] = "monitoring";
    FeatureCategory["AI"] = "ai";
    FeatureCategory["ALERTS"] = "alerts";
    FeatureCategory["PROJECTS"] = "projects";
    FeatureCategory["ORGANIZATION"] = "organization";
    FeatureCategory["DASHBOARD"] = "dashboard";
    FeatureCategory["SECURITY"] = "security";
    FeatureCategory["LIMITS"] = "limits";
    FeatureCategory["INTEGRATIONS"] = "integrations";
})(FeatureCategory || (FeatureCategory = {}));
export var SubscriptionEventType;
(function (SubscriptionEventType) {
    SubscriptionEventType["CREATED"] = "created";
    SubscriptionEventType["UPGRADED"] = "upgraded";
    SubscriptionEventType["DOWNGRADED"] = "downgraded";
    SubscriptionEventType["RENEWED"] = "renewed";
    SubscriptionEventType["TRIAL_STARTED"] = "trial_started";
    SubscriptionEventType["TRIAL_ENDED"] = "trial_ended";
    SubscriptionEventType["CANCELLED"] = "cancelled";
    SubscriptionEventType["RESUMED"] = "resumed";
    SubscriptionEventType["EXPIRED"] = "expired";
    SubscriptionEventType["PAYMENT_FAILED"] = "payment_failed";
    SubscriptionEventType["PAYMENT_SUCCEEDED"] = "payment_succeeded";
    SubscriptionEventType["ADDON_PURCHASED"] = "addon_purchased";
    SubscriptionEventType["FEATURE_OVERRIDE_ADDED"] = "feature_override_added";
})(SubscriptionEventType || (SubscriptionEventType = {}));
export var SubscriptionEventActor;
(function (SubscriptionEventActor) {
    SubscriptionEventActor["USER"] = "user";
    SubscriptionEventActor["ADMIN"] = "admin";
    SubscriptionEventActor["SYSTEM"] = "system";
    SubscriptionEventActor["BILLING_PROVIDER"] = "billing_provider";
})(SubscriptionEventActor || (SubscriptionEventActor = {}));
// ============================================
// COMMON SCHEMAS
// ============================================
export const BillingUuidSchema = z.string().uuid();
export const PaginationSchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
//# sourceMappingURL=types.js.map