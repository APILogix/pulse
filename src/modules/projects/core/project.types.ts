import { z } from "zod";
import { normalizeObjectKeys } from "../shared/schema-utils.js";
import type { ProjectSettings } from "../settings/settings.types.js";
import type { HourlyUsageDto, DailyTrendDto, HeatmapCellDto } from "../usage/usage.types.js";

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
    status: ProjectStatusSchema.default("active"),
    timezone: z.string().max(100).default("UTC"),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
    icon: z.string().max(255).nullable().optional(),
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
      timezone: z.string().max(100).optional(),
      tags: z.array(z.string().min(1).max(50)).max(20).optional(),
      icon: z.string().max(255).nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      version: z.number().int().min(1).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    }),
);
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;

export interface Project {
  id: string;
  /** Immutable public routing identifier, format: prj_XXXXXXXX */
  publicId: string;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  timezone: string;
  tags: string[];
  icon: string | null;
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

export const ProjectByPublicIdParamsSchema = z.object({
  orgId: z.string().uuid(),
  publicId: z.string().regex(/^prj_[A-Z0-9]{8}$/, "Invalid public project ID format"),
});
export type ProjectByPublicIdParams = z.infer<typeof ProjectByPublicIdParamsSchema>;

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
  timezone?: string;
  tags?: string[];
  icon?: string | null;
  metadata?: Record<string, unknown>;
  archivedAt?: Date | null;
  version?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Project members (direct-add only)
// ═══════════════════════════════════════════════════════════════════════════

export const ProjectMemberStatusSchema = z.enum(["pending", "active", "inactive", "removed"]);
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

export const ProjectMemberParamsSchema = ProjectParamsSchema.extend({
  memberId: z.string().uuid(),
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
  z.object({ role: ProjectMemberRoleSchema }),
);
export type UpdateProjectMemberBody = z.infer<typeof UpdateProjectMemberBodySchema>;

export const TransferOwnershipBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    newOwnerUserId: z.string().uuid(),
  }),
);
export type TransferOwnershipBody = z.infer<typeof TransferOwnershipBodySchema>;
