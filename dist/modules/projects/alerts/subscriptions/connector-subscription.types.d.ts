import { z } from "zod";
export declare const AlertCategorySchema: z.ZodEnum<{
    error: "error";
    release: "release";
    security: "security";
    billing: "billing";
    ai: "ai";
    usage: "usage";
    deployment: "deployment";
    performance: "performance";
    cron: "cron";
}>;
export type AlertCategory = z.infer<typeof AlertCategorySchema>;
export declare const ProjectConnectorSubscriptionParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    subscriptionId: z.ZodString;
}, z.core.$strip>;
export declare const CreateProjectConnectorSubscriptionBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    connectorId: z.ZodString;
    enabled: z.ZodDefault<z.ZodCoercedBoolean<unknown>>;
    alertCategories: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        error: "error";
        release: "release";
        security: "security";
        billing: "billing";
        ai: "ai";
        usage: "usage";
        deployment: "deployment";
        performance: "performance";
        cron: "cron";
    }>>>;
    severityThreshold: z.ZodDefault<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    memberIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    channelOverrides: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    quietHours: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    digestMode: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$strip>>;
export type CreateProjectConnectorSubscriptionBody = z.infer<typeof CreateProjectConnectorSubscriptionBodySchema>;
export declare const UpdateProjectConnectorSubscriptionBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    enabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    alertCategories: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        error: "error";
        release: "release";
        security: "security";
        billing: "billing";
        ai: "ai";
        usage: "usage";
        deployment: "deployment";
        performance: "performance";
        cron: "cron";
    }>>>;
    severityThreshold: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    memberIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
    channelOverrides: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    quietHours: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    digestMode: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$strip>>;
export type UpdateProjectConnectorSubscriptionBody = z.infer<typeof UpdateProjectConnectorSubscriptionBodySchema>;
export declare const ListProjectConnectorSubscriptionsQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    enabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodDefault<z.ZodEnum<{
        created_at: "created_at";
        updated_at: "updated_at";
    }>>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>>;
export type ListProjectConnectorSubscriptionsQuery = z.infer<typeof ListProjectConnectorSubscriptionsQuerySchema>;
export interface ProjectConnectorSubscription {
    id: string;
    projectId: string;
    organizationId: string;
    connectorId: string;
    enabled: boolean;
    alertCategories: AlertCategory[];
    severityThreshold: string;
    memberIds: string[];
    channelOverrides: Record<string, unknown>;
    quietHours: Record<string, unknown> | null;
    digestMode: Record<string, unknown> | null;
    createdByUserId: string | null;
    updatedByUserId: string | null;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface AlertRoutingTarget {
    projectId: string;
    organizationId: string;
    environmentId: string | null;
    apiKeyId: string;
    subscriptions: {
        subscriptionId: string;
        connectorId: string;
        enabled: boolean;
        alertCategories: AlertCategory[];
        severityThreshold: string;
        memberIds: string[];
        channelOverrides: Record<string, unknown>;
    }[];
    members: {
        userId: string;
        role: string;
        email: string | null;
    }[];
}
//# sourceMappingURL=connector-subscription.types.d.ts.map