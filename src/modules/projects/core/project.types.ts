import { z } from "zod";
import { normalizeObjectKeys } from "../shared/schema-utils.js";
import type { ProjectSettings } from "../settings/settings.types.js";
import type { HourlyUsageDto, DailyTrendDto, HeatmapCellDto } from "../activity/activity.types.js";

export const ProjectVisibilitySchema = z.enum(["private", "organization", "public"]);
export type ProjectVisibility = z.infer<typeof ProjectVisibilitySchema>;

export const ProjectStatusSchema = z.enum(["active", "paused", "archived"]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectParamsSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export const ProjectSdkConfigParamsSchema = ProjectParamsSchema.extend({
  configId: z.string().uuid(),
});

export const ListProjectsQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    status: ProjectStatusSchema.optional(),
    search: z.string().min(1).max(100).optional(),
    includeDeleted: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "name"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),
);
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;

export const CreateProjectBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(5000).nullable().optional(),
    visibility: ProjectVisibilitySchema.default("private"),
    status: ProjectStatusSchema.default("active"),
    timezone: z.string().max(100).default("UTC"),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
    icon: z.string().max(255).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
);
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const UpdateProjectBodySchema = z.preprocess(
  normalizeObjectKeys,
  z
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
    }),
);
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

export const ProjectMemberRole = {
  OWNER: 'owner',
  ADMIN: 'admin',
  DEVELOPER: 'developer',
  QA: 'qa',
  VIEWER: 'viewer',
} as const;
export type ProjectMemberRole = typeof ProjectMemberRole[keyof typeof ProjectMemberRole];

export const ProjectMemberRoleSchema = z.enum([
  "owner",
  "admin",
  "developer",
  "qa",
  "viewer",
]);

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

// ═══════════════════════════════════════════════════════════════════════════
// Project members, invitations, and custom roles
// ═══════════════════════════════════════════════════════════════════════════

export const ProjectMemberStatusSchema = z.enum(["pending", "active", "inactive", "removed"]);
export type ProjectMemberStatus = z.infer<typeof ProjectMemberStatusSchema>;

export const InvitationStatusSchema = z.enum(["pending", "accepted", "declined", "expired", "cancelled"]);
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

export const ProjectMemberParamsSchema = ProjectParamsSchema.extend({
  memberId: z.string().uuid(),
});

export const ProjectRoleParamsSchema = ProjectParamsSchema.extend({
  roleId: z.string().uuid(),
});

export const ProjectInvitationParamsSchema = ProjectParamsSchema.extend({
  invitationId: z.string().uuid(),
});

export const ListProjectMembersQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    status: ProjectMemberStatusSchema.optional(),
    role: ProjectMemberRoleSchema.optional(),
    search: z.string().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "role"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),
);
export type ListProjectMembersQuery = z.infer<typeof ListProjectMembersQuerySchema>;

export const ListProjectInvitationsQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    status: InvitationStatusSchema.optional(),
    email: z.string().email().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "expires_at"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),
);
export type ListProjectInvitationsQuery = z.infer<typeof ListProjectInvitationsQuerySchema>;

export const AddProjectMemberBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    userId: z.string().uuid(),
    role: ProjectMemberRoleSchema.default("viewer"),
  }),
);
export type AddProjectMemberBody = z.infer<typeof AddProjectMemberBodySchema>;

export const UpdateProjectMemberBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    role: ProjectMemberRoleSchema,
  }),
);
export type UpdateProjectMemberBody = z.infer<typeof UpdateProjectMemberBodySchema>;

export const InviteProjectMemberBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    email: z.string().email(),
    role: ProjectMemberRoleSchema.default("viewer"),
  }),
);
export type InviteProjectMemberBody = z.infer<typeof InviteProjectMemberBodySchema>;

export const AcceptProjectInvitationBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    token: z.string().min(1),
  }),
);
export type AcceptProjectInvitationBody = z.infer<typeof AcceptProjectInvitationBodySchema>;

export const CreateProjectRoleBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    name: z.string().min(1).max(100),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/),
    description: z.string().max(5000).nullable().optional(),
    permissions: z.array(z.string().min(1).max(100)).max(100).default([]),
    isDefault: z.coerce.boolean().optional(),
  }),
);
export type CreateProjectRoleBody = z.infer<typeof CreateProjectRoleBodySchema>;

export const UpdateProjectRoleBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(5000).nullable().optional(),
    permissions: z.array(z.string().min(1).max(100)).max(100).optional(),
    isDefault: z.coerce.boolean().optional(),
  }).refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  }),
);
export type UpdateProjectRoleBody = z.infer<typeof UpdateProjectRoleBodySchema>;

export const TransferOwnershipBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    newOwnerUserId: z.string().uuid(),
  }),
);
export type TransferOwnershipBody = z.infer<typeof TransferOwnershipBodySchema>;
