import { z } from "zod";
import { normalizeObjectKeys, CountryCode, Ipv4OrV6 } from "../shared/schema-utils.js";
import { type ProjectEnvironment, ProjectEnvironmentSchema } from "../environments/environment.types.js";
import type { ProjectSettings } from "../settings/settings.types.js";
import type { HourlyUsageDto, DailyTrendDto, HeatmapCellDto } from "../activity/activity.types.js";

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
    environment: ProjectEnvironmentSchema.optional(),
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

export const projectConfigShape = {
  rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).optional(),
  rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).optional(),
  rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
  burstLimit: z.coerce.number().int().min(1).max(1_000_000).optional(),
  allowedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
  maxEventSizeBytes: z.coerce.number().int().min(1).max(67_108_864).optional(),
  maxBatchSize: z.coerce.number().int().min(1).max(10_000).optional(),
  allowedOrigins: z.array(z.string().min(1).max(255)).max(100).optional(),
  requireHttps: z.coerce.boolean().optional(),
  ipAllowlist: z.array(Ipv4OrV6).max(256).nullable().optional(),
  ipBlocklist: z.array(Ipv4OrV6).max(256).nullable().optional(),
  geoRestrictionEnabled: z.coerce.boolean().optional(),
  allowedCountries: z.array(CountryCode).max(250).nullable().optional(),
  alertEmail: z.string().email().max(255).nullable().optional(),
  alertWebhookUrl: z.string().url().max(500).nullable().optional(),
  alertOnErrorRateThreshold: z.coerce.number().min(0).max(100).optional(),
  alertOnLatencyThresholdMs: z.coerce.number().int().min(1).max(600_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
} as const;

export const CreateProjectBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(5000).nullable().optional(),
    environment: ProjectEnvironmentSchema.default("development"),
    productionApiPrefix: z.string().max(20).nullable().optional(),
    developmentApiPrefix: z.string().max(20).nullable().optional(),
    stagingApiPrefix: z.string().max(20).nullable().optional(),
    ...projectConfigShape,
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
      environment: ProjectEnvironmentSchema.optional(),
      productionApiPrefix: z.string().max(20).nullable().optional(),
      developmentApiPrefix: z.string().max(20).nullable().optional(),
      stagingApiPrefix: z.string().max(20).nullable().optional(),
      ...projectConfigShape,
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

export enum ProjectMemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  DEVELOPER = 'developer',
  VIEWER = 'viewer',
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
