import { z } from "zod";
import { type QuietHoursConfig } from "./quiet-hours.js";
export declare const AlertChannelSeveritySchema: z.ZodEnum<{
    critical: "critical";
    error: "error";
    info: "info";
    warning: "warning";
}>;
export type AlertChannelSeverity = z.infer<typeof AlertChannelSeveritySchema>;
export declare const AlertChannelDigestModeSchema: z.ZodEnum<{
    immediate: "immediate";
    hourly: "hourly";
    daily: "daily";
    weekly: "weekly";
}>;
export type AlertChannelDigestMode = z.infer<typeof AlertChannelDigestModeSchema>;
export declare const ProjectAlertChannelParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    channelId: z.ZodString;
}, z.core.$strip>;
export declare const ProjectAlertChannelBaseParamsSchema: z.ZodObject<{
    projectId: z.ZodString;
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const ListProjectAlertChannelsQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    channelType: z.ZodOptional<z.ZodString>;
    enabled: z.ZodOptional<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
    page: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodDefault<z.ZodEnum<{
        name: "name";
        created_at: "created_at";
        updated_at: "updated_at";
    }>>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>>;
export type ListProjectAlertChannelsQuery = z.infer<typeof ListProjectAlertChannelsQuerySchema>;
export declare const CreateProjectAlertChannelBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    connectorId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    channelType: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    destination: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    destinationMetadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    isDefault: z.ZodDefault<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
    enabled: z.ZodDefault<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
}, z.core.$strip>>;
export type CreateProjectAlertChannelBody = z.infer<typeof CreateProjectAlertChannelBodySchema>;
export declare const UpdateProjectAlertChannelBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    connectorId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    channelType: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    destination: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    destinationMetadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    isDefault: z.ZodOptional<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
    enabled: z.ZodOptional<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
    version: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export type UpdateProjectAlertChannelBody = z.infer<typeof UpdateProjectAlertChannelBodySchema>;
export declare const ToggleProjectAlertChannelBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    enabled: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>;
    version: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export type ToggleProjectAlertChannelBody = z.infer<typeof ToggleProjectAlertChannelBodySchema>;
export declare const UpsertMemberAlertChannelPreferenceBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    category: z.ZodDefault<z.ZodString>;
    severityThreshold: z.ZodDefault<z.ZodEnum<{
        critical: "critical";
        error: "error";
        info: "info";
        warning: "warning";
    }>>;
    enabled: z.ZodDefault<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
    digestMode: z.ZodDefault<z.ZodEnum<{
        immediate: "immediate";
        hourly: "hourly";
        daily: "daily";
        weekly: "weekly";
    }>>;
    quietHours: z.ZodDefault<z.ZodUnion<readonly [z.ZodObject<{}, z.core.$strict>, z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        timezone: z.ZodDefault<z.ZodString>;
        start: z.ZodString;
        end: z.ZodString;
        days: z.ZodDefault<z.ZodArray<z.ZodNumber>>;
    }, z.core.$strict>]>>;
}, z.core.$strip>>;
export type UpsertMemberAlertChannelPreferenceBody = z.infer<typeof UpsertMemberAlertChannelPreferenceBodySchema>;
export declare const DeleteMemberAlertChannelPreferenceQuerySchema: z.ZodObject<{
    category: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type DeleteMemberAlertChannelPreferenceQuery = z.infer<typeof DeleteMemberAlertChannelPreferenceQuerySchema>;
export interface ProjectAlertChannel {
    id: string;
    organizationId: string;
    projectId: string;
    connectorId: string | null;
    channelType: string;
    name: string;
    description: string | null;
    destination: string | null;
    destinationMetadata: Record<string, unknown>;
    isDefault: boolean;
    enabled: boolean;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    version: number;
}
export interface ProjectMemberAlertChannelPreference {
    id: string;
    organizationId: string;
    projectId: string;
    userId: string;
    projectAlertChannelId: string;
    category: string;
    severityThreshold: AlertChannelSeverity;
    enabled: boolean;
    digestMode: AlertChannelDigestMode;
    quietHours: QuietHoursConfig | Record<string, never>;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    version: number;
    channel?: ProjectAlertChannel;
}
export interface ImmediateDeliveryRequest {
    organizationId: string;
    projectId: string;
    category: string;
    severity: AlertChannelSeverity;
}
export interface ImmediateDeliveryTarget {
    organizationId: string;
    projectId: string;
    userId: string;
    memberRole: string;
    memberEmail: string | null;
    channelId: string;
    channelType: string;
    channelDestination: string | null;
    memberDestination: string | null;
    channelMetadata: Record<string, unknown>;
    channelConnectorId: string | null;
    subscriptionId: string | null;
    subscriptionConnectorId: string | null;
    connectorProvider: string | null;
    category: string;
    severity: AlertChannelSeverity;
    digest: {
        project: AlertChannelDigestMode;
        member: AlertChannelDigestMode;
        subscription: AlertChannelDigestMode;
    };
    quietHours: {
        project: Record<string, unknown>;
        member: Record<string, unknown>;
        subscription: Record<string, unknown>;
        configured: boolean;
    };
    immediateEligible: true;
}
//# sourceMappingURL=channel.types.d.ts.map