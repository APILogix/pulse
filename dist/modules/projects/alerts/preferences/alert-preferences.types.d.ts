import { z } from "zod";
import { type AlertCategory } from "../subscriptions/connector-subscription.types.js";
export declare const NotificationChannelSchema: z.ZodEnum<{
    push: "push";
    sms: "sms";
    email: "email";
    webhook: "webhook";
    slack: "slack";
}>;
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
export declare const UpdateAlertPreferenceBodySchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    severity_threshold: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    digest_mode: z.ZodOptional<z.ZodString>;
    quiet_hours: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodObject<{}, z.core.$strict>, z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        timezone: z.ZodDefault<z.ZodString>;
        start: z.ZodString;
        end: z.ZodString;
        days: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strict>]>>>;
}, z.core.$strip>;
export type UpdateAlertPreferenceBody = z.infer<typeof UpdateAlertPreferenceBodySchema>;
export declare const BulkSubscribeBodySchema: z.ZodObject<{
    channel: z.ZodEnum<{
        push: "push";
        sms: "sms";
        email: "email";
        webhook: "webhook";
        slack: "slack";
    }>;
    category: z.ZodEnum<{
        error: "error";
        release: "release";
        security: "security";
        ai: "ai";
        billing: "billing";
        usage: "usage";
        cron: "cron";
        all: "all";
        deployment: "deployment";
        performance: "performance";
    }>;
    userIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type BulkSubscribeBody = z.infer<typeof BulkSubscribeBodySchema>;
export interface ProjectMemberNotificationPreference {
    id: string;
    projectId: string;
    userId: string;
    channel: NotificationChannel;
    category: AlertCategory;
    enabled: boolean;
    severityThreshold: string;
    digestMode: string;
    quietHours: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface ProjectNotificationPreference {
    id: string;
    projectId: string;
    organizationId: string;
    category: AlertCategory;
    enabled: boolean;
    severityThreshold: string;
    connectorIds: string[];
    memberIds: string[];
    quietHours: Record<string, unknown> | null;
    digestMode: string;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=alert-preferences.types.d.ts.map