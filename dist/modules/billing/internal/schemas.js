import { z } from 'zod';
export const UuidSchema = z.string().uuid();
export const FeatureParamsSchema = z.object({
    orgId: UuidSchema,
    featureKey: z.string().min(1).max(128),
});
export const OrgParamsSchema = z.object({
    orgId: UuidSchema,
});
export const EventUsageBodySchema = z.object({
    requestId: UuidSchema.optional(),
    organizationId: UuidSchema,
    projectId: UuidSchema.optional().nullable(),
    eventType: z.string().min(1).max(64),
    count: z.coerce.number().int().positive().max(1_000_000),
    sizeBytes: z.coerce.number().int().nonnegative().optional(),
});
export const BulkEventUsageBodySchema = z.object({
    items: z.array(z.object({
        requestId: UuidSchema.optional(),
        orgId: UuidSchema,
        projectId: UuidSchema.optional().nullable(),
        eventType: z.string().min(1).max(64),
        count: z.coerce.number().int().positive().max(1_000_000),
    })).min(1).max(500),
});
export const AiCreditUsageBodySchema = z.object({
    requestId: UuidSchema.optional(),
    organizationId: UuidSchema,
    projectId: UuidSchema.optional().nullable(),
    userId: UuidSchema.optional().nullable(),
    featureKey: z.string().min(1).max(128),
    credits: z.coerce.number().int().positive().max(1_000_000),
    model: z.string().max(128).optional(),
    provider: z.string().max(64).optional(),
    tokens: z.object({
        prompt: z.coerce.number().int().nonnegative().optional(),
        completion: z.coerce.number().int().nonnegative().optional(),
        total: z.coerce.number().int().nonnegative().optional(),
    }).optional(),
});
export const BulkAiCreditUsageBodySchema = z.object({
    items: z.array(AiCreditUsageBodySchema).min(1).max(500),
});
export const ResourceUsageBodySchema = z.object({
    organizationId: UuidSchema,
    resourceType: z.enum(['projects', 'members', 'apiKeys', 'connectors', 'alertRules', 'dashboards']),
    delta: z.coerce.number().int().positive().max(10_000),
});
export const QuotaCheckBodySchema = z.object({
    eventType: z.string().min(1).max(64),
    requestedCount: z.coerce.number().int().positive().max(1_000_000),
});
export const SubscriptionSyncBodySchema = z.object({
    provider: z.enum(['stripe', 'razorpay']).optional(),
});
export const InvoiceGenerateBodySchema = z.object({
    organizationId: UuidSchema,
    periodEnd: z.coerce.date(),
});
export const InvoiceFinalizeBodySchema = z.object({
    invoiceId: UuidSchema,
});
export const PaymentReconcileBodySchema = z.object({
    provider: z.enum(['stripe', 'razorpay']),
    dateFrom: z.coerce.date(),
    dateTo: z.coerce.date(),
});
export const CouponValidateBodySchema = z.object({
    code: z.string().trim().min(1).max(128),
    organizationId: UuidSchema,
    planId: UuidSchema,
});
export const CouponRedeemBodySchema = z.object({
    code: z.string().trim().min(1).max(128),
    organizationId: UuidSchema,
    subscriptionId: UuidSchema,
    invoiceId: UuidSchema.optional(),
});
//# sourceMappingURL=schemas.js.map