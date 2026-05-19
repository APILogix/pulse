// types.ts - Billing Module Types
// ============================================
// ENUMS
// ============================================
export var PlanTier;
(function (PlanTier) {
    PlanTier["STARTER"] = "starter";
    PlanTier["PROFESSIONAL"] = "professional";
    PlanTier["ENTERPRISE"] = "enterprise";
    PlanTier["CUSTOM"] = "custom";
})(PlanTier || (PlanTier = {}));
export var BillingInterval;
(function (BillingInterval) {
    BillingInterval["MONTHLY"] = "monthly";
    BillingInterval["YEARLY"] = "yearly";
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
//# sourceMappingURL=types.js.map