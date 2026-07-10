import { z } from "zod";
import { type ProjectEnvironment } from "../environments/environment.types.js";
import type { ProjectSettings } from "../settings/settings.types.js";
import type { HourlyUsageDto, DailyTrendDto, HeatmapCellDto } from "../activity/activity.types.js";
export declare const ProjectStatusSchema: z.ZodEnum<{
    active: "active";
    archived: "archived";
    paused: "paused";
}>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export declare const ProjectParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
}, z.core.$strip>;
export declare const ProjectSdkConfigParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    configId: z.ZodString;
}, z.core.$strip>;
export declare const ListProjectsQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        archived: "archived";
        paused: "paused";
    }>>;
    environment: z.ZodOptional<z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>>;
    search: z.ZodOptional<z.ZodString>;
    includeDeleted: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodDefault<z.ZodEnum<{
        name: "name";
        updated_at: "updated_at";
        created_at: "created_at";
    }>>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>>;
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
export declare const projectConfigShape: {
    readonly rateLimitPerSecond: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    readonly rateLimitPerMinute: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    readonly rateLimitPerHour: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    readonly burstLimit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    readonly allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    readonly maxEventSizeBytes: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    readonly maxBatchSize: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    readonly allowedOrigins: z.ZodOptional<z.ZodArray<z.ZodString>>;
    readonly requireHttps: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    readonly ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    readonly ipBlocklist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    readonly geoRestrictionEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    readonly allowedCountries: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>>>;
    readonly alertEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    readonly alertWebhookUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    readonly alertOnErrorRateThreshold: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    readonly alertOnLatencyThresholdMs: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    readonly metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    readonly settings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
};
export declare const CreateProjectBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    rateLimitPerSecond: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    rateLimitPerHour: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    burstLimit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    maxEventSizeBytes: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    maxBatchSize: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    allowedOrigins: z.ZodOptional<z.ZodArray<z.ZodString>>;
    requireHttps: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    ipBlocklist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    geoRestrictionEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    allowedCountries: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>>>;
    alertEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertWebhookUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertOnErrorRateThreshold: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    alertOnLatencyThresholdMs: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    settings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    environment: z.ZodDefault<z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>>;
    productionApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    developmentApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stagingApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>>;
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;
export declare const UpdateProjectBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    rateLimitPerSecond: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    rateLimitPerHour: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    burstLimit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    maxEventSizeBytes: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    maxBatchSize: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    allowedOrigins: z.ZodOptional<z.ZodArray<z.ZodString>>;
    requireHttps: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    ipBlocklist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    geoRestrictionEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    allowedCountries: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>>>;
    alertEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertWebhookUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertOnErrorRateThreshold: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    alertOnLatencyThresholdMs: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    settings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        archived: "archived";
        paused: "paused";
    }>>;
    environment: z.ZodOptional<z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>>;
    productionApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    developmentApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stagingApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>>;
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;
export interface Project {
    id: string;
    orgId: string;
    name: string;
    slug: string;
    description: string | null;
    status: ProjectStatus;
    environment: ProjectEnvironment;
    productionApiPrefix: string | null;
    developmentApiPrefix: string | null;
    stagingApiPrefix: string | null;
    rateLimitPerSecond: number;
    rateLimitPerMinute: number;
    rateLimitPerHour: number;
    burstLimit: number;
    allowedEventTypes: string[];
    maxEventSizeBytes: number;
    maxBatchSize: number;
    allowedOrigins: string[];
    requireHttps: boolean;
    ipAllowlist: string[] | null;
    ipBlocklist: string[] | null;
    geoRestrictionEnabled: boolean;
    allowedCountries: string[] | null;
    alertEmail: string | null;
    alertWebhookUrl: string | null;
    alertOnErrorRateThreshold: number;
    alertOnLatencyThresholdMs: number;
    metadata: Record<string, unknown>;
    settings: Record<string, unknown>;
    archivedAt: Date | null;
    deletedAt: Date | null;
    deletedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface ProjectListItem extends Project {
    apiKeysCount: number;
    activeApiKeysCount: number;
}
export interface ProjectStats {
    totalRequests: number;
    apiKeysCount: number;
    activeKeysCount: number;
    environmentCount: number;
}
export interface ProjectWithStats extends Project {
    stats: ProjectStats;
}
export declare enum ProjectMemberRole {
    OWNER = "owner",
    ADMIN = "admin",
    DEVELOPER = "developer",
    VIEWER = "viewer"
}
export interface ProjectMember {
    id: string;
    projectId: string;
    userId: string;
    organizationId: string;
    role: ProjectMemberRole;
    status: string;
    invitedBy: string | null;
    invitedAt: Date | null;
    joinedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface ProjectOverviewDto {
    project: any;
    settings: ProjectSettings;
    memberCount: number;
    apiKeyCount: number;
    usage: {
        totalEventsToday: number;
        totalBytesToday: number;
        peakHour: number;
        currentHourEvents: number;
        categoryBreakdown: Record<string, number>;
        eventTypeBreakdown: Record<string, number>;
        hourlyBreakdown: HourlyUsageDto[];
        dailyTrend: DailyTrendDto[];
        heatmapData: HeatmapCellDto[];
    };
}
export interface ProjectUpdateInput {
    name?: string;
    description?: string | null;
    status?: ProjectStatus;
    environment?: ProjectEnvironment;
    productionApiPrefix?: string | null;
    developmentApiPrefix?: string | null;
    stagingApiPrefix?: string | null;
    rateLimitPerSecond?: number;
    rateLimitPerMinute?: number;
    rateLimitPerHour?: number;
    burstLimit?: number;
    allowedEventTypes?: string[];
    maxEventSizeBytes?: number;
    maxBatchSize?: number;
    allowedOrigins?: string[];
    requireHttps?: boolean;
    ipAllowlist?: string[] | null;
    ipBlocklist?: string[] | null;
    geoRestrictionEnabled?: boolean;
    allowedCountries?: string[] | null;
    alertEmail?: string | null;
    alertWebhookUrl?: string | null;
    alertOnErrorRateThreshold?: number;
    alertOnLatencyThresholdMs?: number;
    metadata?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    archivedAt?: Date | null;
}
//# sourceMappingURL=project.types.d.ts.map