import { z } from "zod";
import type { ProjectSettings } from "../settings/settings.types.js";
import type { HourlyUsageDto, DailyTrendDto, HeatmapCellDto } from "../usage/usage.types.js";
export declare const ProjectVisibilitySchema: z.ZodEnum<{
    public: "public";
    private: "private";
    organization: "organization";
}>;
export type ProjectVisibility = z.infer<typeof ProjectVisibilitySchema>;
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
    search: z.ZodOptional<z.ZodString>;
    includeDeleted: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
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
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
export declare const CreateProjectBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    visibility: z.ZodDefault<z.ZodEnum<{
        public: "public";
        private: "private";
        organization: "organization";
    }>>;
    status: z.ZodDefault<z.ZodEnum<{
        active: "active";
        archived: "archived";
        paused: "paused";
    }>>;
    timezone: z.ZodDefault<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    color: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>>;
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;
export declare const UpdateProjectBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        archived: "archived";
        paused: "paused";
    }>>;
    visibility: z.ZodOptional<z.ZodEnum<{
        public: "public";
        private: "private";
        organization: "organization";
    }>>;
    timezone: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    icon: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    color: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    version: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>>;
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;
export interface Project {
    id: string;
    orgId: string;
    name: string;
    slug: string;
    description: string | null;
    status: ProjectStatus;
    visibility: ProjectVisibility;
    timezone: string;
    tags: string[];
    icon: string | null;
    color: string | null;
    metadata: Record<string, unknown>;
    archivedAt: Date | null;
    deletedAt: Date | null;
    deletedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    version: number;
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
export declare const ProjectMemberRole: {
    readonly OWNER: "owner";
    readonly ADMIN: "admin";
    readonly DEVELOPER: "developer";
    readonly QA: "qa";
    readonly VIEWER: "viewer";
};
export type ProjectMemberRole = typeof ProjectMemberRole[keyof typeof ProjectMemberRole];
export declare const ProjectMemberRoleSchema: z.ZodEnum<{
    admin: "admin";
    owner: "owner";
    developer: "developer";
    viewer: "viewer";
    qa: "qa";
}>;
export interface ProjectOverviewDto {
    project: Project;
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
    visibility?: ProjectVisibility;
    timezone?: string;
    tags?: string[];
    icon?: string | null;
    color?: string | null;
    metadata?: Record<string, unknown>;
    archivedAt?: Date | null;
    version?: number;
}
export declare const ProjectMemberStatusSchema: z.ZodEnum<{
    active: "active";
    inactive: "inactive";
    removed: "removed";
    pending: "pending";
}>;
export type ProjectMemberStatus = z.infer<typeof ProjectMemberStatusSchema>;
export interface ProjectMember {
    id: string;
    projectId: string;
    userId: string;
    organizationId: string;
    role: ProjectMemberRole;
    status: ProjectMemberStatus;
    invitedByUserId: string | null;
    invitedAt: Date | null;
    joinedAt: Date | null;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date | null;
    user: {
        id: string;
        email: string;
        fullName: string;
    } | undefined;
}
export declare const ProjectMemberParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    memberId: z.ZodString;
}, z.core.$strip>;
export declare const ListProjectMembersQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        inactive: "inactive";
        removed: "removed";
        pending: "pending";
    }>>;
    role: z.ZodOptional<z.ZodEnum<{
        admin: "admin";
        owner: "owner";
        developer: "developer";
        viewer: "viewer";
        qa: "qa";
    }>>;
    search: z.ZodOptional<z.ZodString>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodDefault<z.ZodEnum<{
        role: "role";
        created_at: "created_at";
        updated_at: "updated_at";
    }>>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>>;
export type ListProjectMembersQuery = z.infer<typeof ListProjectMembersQuerySchema>;
export declare const AddProjectMemberBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    userId: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<{
        admin: "admin";
        owner: "owner";
        developer: "developer";
        viewer: "viewer";
        qa: "qa";
    }>>;
}, z.core.$strip>>;
export type AddProjectMemberBody = z.infer<typeof AddProjectMemberBodySchema>;
export declare const UpdateProjectMemberBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    role: z.ZodEnum<{
        admin: "admin";
        owner: "owner";
        developer: "developer";
        viewer: "viewer";
        qa: "qa";
    }>;
}, z.core.$strip>>;
export type UpdateProjectMemberBody = z.infer<typeof UpdateProjectMemberBodySchema>;
export declare const TransferOwnershipBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    newOwnerUserId: z.ZodString;
}, z.core.$strip>>;
export type TransferOwnershipBody = z.infer<typeof TransferOwnershipBodySchema>;
//# sourceMappingURL=project.types.d.ts.map