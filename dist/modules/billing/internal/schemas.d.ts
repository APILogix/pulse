import { z } from 'zod';
export declare const UuidSchema: z.ZodString;
export declare const FeatureParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    featureKey: z.ZodString;
}, z.core.$strip>;
export declare const OrgParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const EventUsageBodySchema: z.ZodObject<{
    requestId: z.ZodOptional<z.ZodString>;
    organizationId: z.ZodString;
    projectId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    eventType: z.ZodString;
    count: z.ZodCoercedNumber<unknown>;
    sizeBytes: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const BulkEventUsageBodySchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        requestId: z.ZodOptional<z.ZodString>;
        orgId: z.ZodString;
        projectId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        eventType: z.ZodString;
        count: z.ZodCoercedNumber<unknown>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const AiCreditUsageBodySchema: z.ZodObject<{
    requestId: z.ZodOptional<z.ZodString>;
    organizationId: z.ZodString;
    projectId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    userId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    featureKey: z.ZodString;
    credits: z.ZodCoercedNumber<unknown>;
    model: z.ZodOptional<z.ZodString>;
    provider: z.ZodOptional<z.ZodString>;
    tokens: z.ZodOptional<z.ZodObject<{
        prompt: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        completion: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        total: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const BulkAiCreditUsageBodySchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        requestId: z.ZodOptional<z.ZodString>;
        organizationId: z.ZodString;
        projectId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        userId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        featureKey: z.ZodString;
        credits: z.ZodCoercedNumber<unknown>;
        model: z.ZodOptional<z.ZodString>;
        provider: z.ZodOptional<z.ZodString>;
        tokens: z.ZodOptional<z.ZodObject<{
            prompt: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            completion: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
            total: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const ResourceUsageBodySchema: z.ZodObject<{
    organizationId: z.ZodString;
    resourceType: z.ZodEnum<{
        projects: "projects";
        members: "members";
        apiKeys: "apiKeys";
        connectors: "connectors";
        alertRules: "alertRules";
        dashboards: "dashboards";
    }>;
    delta: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const QuotaCheckBodySchema: z.ZodObject<{
    eventType: z.ZodString;
    requestedCount: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const SubscriptionSyncBodySchema: z.ZodObject<{
    provider: z.ZodOptional<z.ZodEnum<{
        stripe: "stripe";
        razorpay: "razorpay";
    }>>;
}, z.core.$strip>;
export declare const InvoiceGenerateBodySchema: z.ZodObject<{
    organizationId: z.ZodString;
    periodEnd: z.ZodCoercedDate<unknown>;
}, z.core.$strip>;
export declare const InvoiceFinalizeBodySchema: z.ZodObject<{
    invoiceId: z.ZodString;
}, z.core.$strip>;
export declare const PaymentReconcileBodySchema: z.ZodObject<{
    provider: z.ZodEnum<{
        stripe: "stripe";
        razorpay: "razorpay";
    }>;
    dateFrom: z.ZodCoercedDate<unknown>;
    dateTo: z.ZodCoercedDate<unknown>;
}, z.core.$strip>;
export declare const CouponValidateBodySchema: z.ZodObject<{
    code: z.ZodString;
    organizationId: z.ZodString;
    planId: z.ZodString;
}, z.core.$strip>;
export declare const CouponRedeemBodySchema: z.ZodObject<{
    code: z.ZodString;
    organizationId: z.ZodString;
    subscriptionId: z.ZodString;
    invoiceId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type EventUsageBody = z.infer<typeof EventUsageBodySchema>;
export type BulkEventUsageBody = z.infer<typeof BulkEventUsageBodySchema>;
export type AiCreditUsageBody = z.infer<typeof AiCreditUsageBodySchema>;
export type BulkAiCreditUsageBody = z.infer<typeof BulkAiCreditUsageBodySchema>;
export type ResourceUsageBody = z.infer<typeof ResourceUsageBodySchema>;
export type QuotaCheckBody = z.infer<typeof QuotaCheckBodySchema>;
export type InvoiceGenerateBody = z.infer<typeof InvoiceGenerateBodySchema>;
export type InvoiceFinalizeBody = z.infer<typeof InvoiceFinalizeBodySchema>;
export type PaymentReconcileBody = z.infer<typeof PaymentReconcileBodySchema>;
export type CouponValidateBody = z.infer<typeof CouponValidateBodySchema>;
export type CouponRedeemBody = z.infer<typeof CouponRedeemBodySchema>;
//# sourceMappingURL=schemas.d.ts.map