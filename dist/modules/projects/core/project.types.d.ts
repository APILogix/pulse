import { z } from "zod";
import type { ProjectSettings } from "../settings/settings.types.js";
import type { HourlyUsageDto, DailyTrendDto, HeatmapCellDto } from "../activity/activity.types.js";
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
export interface ProjectMember {
    id: string;
    projectId: string;
    userId: string;
    organizationId: string;
    role: ProjectMemberRole;
    roleId: string | null;
    status: 'pending' | 'active' | 'inactive' | 'removed';
    addedByUserId: string | null;
    addedAt: Date;
    removedByUserId: string | null;
    removedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
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
}
export declare const ProjectMemberStatusSchema: z.ZodEnum<{
    active: "active";
    inactive: "inactive";
    removed: "removed";
    pending: "pending";
}>;
export type ProjectMemberStatus = z.infer<typeof ProjectMemberStatusSchema>;
export declare const InvitationStatusSchema: z.ZodEnum<{
    expired: "expired";
    pending: "pending";
    cancelled: "cancelled";
    accepted: "accepted";
    declined: "declined";
}>;
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;
export interface ProjectMember {
    id: string;
    projectId: string;
    userId: string;
    organizationId: string;
    role: ProjectMemberRole;
    roleId: string | null;
    status: ProjectMemberStatus;
    addedByUserId: string | null;
    addedAt: Date;
    removedByUserId: string | null;
    removedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    user: {
        id: string;
        email: string;
        fullName: string;
    } | undefined;
}
export interface ProjectMemberInvitation {
    id: string;
    projectId: string;
    organizationId: string;
    email: string;
    invitedByUserId: string;
    invitedUserId: string | null;
    role: ProjectMemberRole;
    status: InvitationStatus;
    expiresAt: Date;
    acceptedAt: Date | null;
    declinedAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface ProjectRole {
    id: string;
    projectId: string | null;
    organizationId: string;
    name: string;
    slug: string;
    description: string | null;
    isSystem: boolean;
    isDefault: boolean;
    permissions: string[];
    createdAt: Date;
    updatedAt: Date;
}
export declare const ProjectMemberParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    memberId: z.ZodString;
}, z.core.$strip>;
export declare const ProjectRoleParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    roleId: z.ZodString;
}, z.core.$strip>;
export declare const ProjectInvitationParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    invitationId: z.ZodString;
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
export declare const ListProjectInvitationsQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        expired: "expired";
        pending: "pending";
        cancelled: "cancelled";
        accepted: "accepted";
        declined: "declined";
    }>>;
    email: z.ZodOptional<z.ZodString>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodDefault<z.ZodEnum<{
        expires_at: "expires_at";
        created_at: "created_at";
        updated_at: "updated_at";
    }>>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>>;
export type ListProjectInvitationsQuery = z.infer<typeof ListProjectInvitationsQuerySchema>;
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
export declare const InviteProjectMemberBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    email: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<{
        admin: "admin";
        owner: "owner";
        developer: "developer";
        viewer: "viewer";
        qa: "qa";
    }>>;
}, z.core.$strip>>;
export type InviteProjectMemberBody = z.infer<typeof InviteProjectMemberBodySchema>;
export declare const AcceptProjectInvitationBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>>;
export type AcceptProjectInvitationBody = z.infer<typeof AcceptProjectInvitationBodySchema>;
export declare const CreateProjectRoleBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodString;
    slug: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    permissions: z.ZodDefault<z.ZodArray<z.ZodString>>;
    isDefault: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
}, z.core.$strip>>;
export type CreateProjectRoleBody = z.infer<typeof CreateProjectRoleBodySchema>;
export declare const UpdateProjectRoleBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    permissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    isDefault: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
}, z.core.$strip>>;
export type UpdateProjectRoleBody = z.infer<typeof UpdateProjectRoleBodySchema>;
export declare const TransferOwnershipBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    newOwnerUserId: z.ZodString;
}, z.core.$strip>>;
export type TransferOwnershipBody = z.infer<typeof TransferOwnershipBodySchema>;
//# sourceMappingURL=project.types.d.ts.map