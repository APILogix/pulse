import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
export declare enum PlanTier {
    FREE = "free",
    STARTER = "starter",
    GROWTH = "growth",
    BUSINESS = "business",
    ENTERPRISE = "enterprise"
}
export declare enum SubscriptionStatus {
    TRIALING = "trialing",
    ACTIVE = "active",
    PAST_DUE = "past_due",
    PAUSED = "paused",
    CANCELLED = "cancelled",
    EXPIRED = "expired",
    INCOMPLETE = "incomplete"
}
export declare enum BillingProvider {
    STRIPE = "stripe",
    RAZORPAY = "razorpay",
    MANUAL = "manual",
    SYSTEM = "system"
}
export declare enum BillingInterval {
    MONTHLY = "monthly",
    ANNUAL = "annual"
}
export declare enum InvoiceStatus {
    DRAFT = "draft",
    OPEN = "open",
    PAID = "paid",
    VOID = "void",
    UNCOLLECTIBLE = "uncollectible",
    REFUNDED = "refunded"
}
export declare enum PaymentStatus {
    PENDING = "pending",
    PROCESSING = "processing",
    SUCCEEDED = "succeeded",
    FAILED = "failed",
    CANCELLED = "cancelled",
    REFUNDED = "refunded"
}
export declare enum CouponDiscountType {
    PERCENTAGE = "percentage",
    FIXED_AMOUNT = "fixed_amount"
}
export declare enum FeatureValueType {
    BOOLEAN = "boolean",
    INTEGER = "integer",
    DECIMAL = "decimal",
    STRING = "string"
}
export declare enum FeatureCategory {
    MONITORING = "monitoring",
    AI = "ai",
    ALERTS = "alerts",
    PROJECTS = "projects",
    ORGANIZATION = "organization",
    DASHBOARD = "dashboard",
    SECURITY = "security",
    LIMITS = "limits",
    INTEGRATIONS = "integrations"
}
export declare enum SubscriptionEventType {
    CREATED = "created",
    UPGRADED = "upgraded",
    DOWNGRADED = "downgraded",
    RENEWED = "renewed",
    TRIAL_STARTED = "trial_started",
    TRIAL_ENDED = "trial_ended",
    CANCELLED = "cancelled",
    RESUMED = "resumed",
    EXPIRED = "expired",
    PAYMENT_FAILED = "payment_failed",
    PAYMENT_SUCCEEDED = "payment_succeeded",
    ADDON_PURCHASED = "addon_purchased",
    FEATURE_OVERRIDE_ADDED = "feature_override_added"
}
export declare enum SubscriptionEventActor {
    USER = "user",
    ADMIN = "admin",
    SYSTEM = "system",
    BILLING_PROVIDER = "billing_provider"
}
export declare const BillingUuidSchema: z.ZodString;
export declare const PaginationSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export type PaginationQuery = z.infer<typeof PaginationSchema>;
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
export interface AuthenticatedRequest extends FastifyRequest {
    user?: {
        id: string;
        email: string;
        isAdmin: boolean;
        sessionId: string;
        mfaVerified: boolean;
        stepUpFresh: boolean;
        orgId?: string;
        currentOrgId?: string;
    };
}
export type RequestWithUser = AuthenticatedRequest;
//# sourceMappingURL=types.d.ts.map