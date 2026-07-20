import { z } from "zod";
import { normalizeObjectKeys } from "../shared/schema-utils.js";
export const ProjectVisibilitySchema = z.enum(["private", "organization", "public"]);
export const ProjectStatusSchema = z.enum(["active", "paused", "archived"]);
export const ProjectParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
});
export const ProjectSdkConfigParamsSchema = ProjectParamsSchema.extend({
    configId: z.string().uuid(),
});
export const ListProjectsQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    status: ProjectStatusSchema.optional(),
    search: z.string().min(1).max(100).optional(),
    includeDeleted: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "name"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
}));
export const CreateProjectBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(5000).nullable().optional(),
    visibility: ProjectVisibilitySchema.default("private"),
    status: ProjectStatusSchema.default("active"),
    timezone: z.string().max(100).default("UTC"),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
    icon: z.string().max(255).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
}));
export const UpdateProjectBodySchema = z.preprocess(normalizeObjectKeys, z
    .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: ProjectStatusSchema.optional(),
    visibility: ProjectVisibilitySchema.optional(),
    timezone: z.string().max(100).optional(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
    icon: z.string().max(255).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
})
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
export const ProjectMemberRole = {
    OWNER: 'owner',
    ADMIN: 'admin',
    DEVELOPER: 'developer',
    QA: 'qa',
    VIEWER: 'viewer',
};
export const ProjectMemberRoleSchema = z.enum([
    "owner",
    "admin",
    "developer",
    "qa",
    "viewer",
]);
// ═══════════════════════════════════════════════════════════════════════════
// Project members, invitations, and custom roles
// ═══════════════════════════════════════════════════════════════════════════
export const ProjectMemberStatusSchema = z.enum(["pending", "active", "inactive", "removed"]);
export const InvitationStatusSchema = z.enum(["pending", "accepted", "declined", "expired", "cancelled"]);
export const ProjectMemberParamsSchema = ProjectParamsSchema.extend({
    memberId: z.string().uuid(),
});
export const ProjectRoleParamsSchema = ProjectParamsSchema.extend({
    roleId: z.string().uuid(),
});
export const ProjectInvitationParamsSchema = ProjectParamsSchema.extend({
    invitationId: z.string().uuid(),
});
export const ListProjectMembersQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    status: ProjectMemberStatusSchema.optional(),
    role: ProjectMemberRoleSchema.optional(),
    search: z.string().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "role"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
}));
export const ListProjectInvitationsQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    status: InvitationStatusSchema.optional(),
    email: z.string().email().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "expires_at"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
}));
export const AddProjectMemberBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    userId: z.string().uuid(),
    role: ProjectMemberRoleSchema.default("viewer"),
}));
export const UpdateProjectMemberBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    role: ProjectMemberRoleSchema,
}));
export const InviteProjectMemberBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    email: z.string().email(),
    role: ProjectMemberRoleSchema.default("viewer"),
}));
export const AcceptProjectInvitationBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    token: z.string().min(1),
}));
export const CreateProjectRoleBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    name: z.string().min(1).max(100),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/),
    description: z.string().max(5000).nullable().optional(),
    permissions: z.array(z.string().min(1).max(100)).max(100).default([]),
    isDefault: z.coerce.boolean().optional(),
}));
export const UpdateProjectRoleBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(5000).nullable().optional(),
    permissions: z.array(z.string().min(1).max(100)).max(100).optional(),
    isDefault: z.coerce.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
export const TransferOwnershipBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    newOwnerUserId: z.string().uuid(),
}));
//# sourceMappingURL=project.types.js.map