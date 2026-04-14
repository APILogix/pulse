import { z } from "zod";

const normalizeObjectKeys = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;

  return {
    ...record,
    productionApiPrefix:
      record.productionApiPrefix ?? record.production_api_prefix,
    developmentApiPrefix:
      record.developmentApiPrefix ?? record.development_api_prefix,
    expiresAt: record.expiresAt ?? record.expires_at,
    gracePeriodHours:
      record.gracePeriodHours ?? record.grace_period_hours,
    sortBy: record.sortBy ?? record.sort_by,
    sortOrder: record.sortOrder ?? record.sort_order,
    isActive: record.isActive ?? record.is_active,
  };
};

const OptionalDateSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    return new Date(value);
  }

  return value;
}, z.date().nullable().optional());

export const ProjectStatusSchema = z.enum(["active", "paused", "archived"]);
export const ProjectEnvironmentSchema = z.enum(["development", "production"]);
export const OrgRoleSchema = z.enum([
  "owner",
  "admin",
  "billing",
  "member",
  "viewer",
]);

export const OrgIdParamsSchema = z.object({
  orgId: z.string().uuid(),
});

export const ProjectParamsSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export const ApiKeyParamsSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  apiKeyId: z.string().uuid(),
});

export const ListProjectsQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    status: ProjectStatusSchema.optional(),
    environment: ProjectEnvironmentSchema.optional(),
    search: z.string().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "name"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),
);

export const CreateProjectBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(5000).nullable().optional(),
    environment: ProjectEnvironmentSchema.default("development"),
    productionApiPrefix: z.string().max(20).nullable().optional(),
    developmentApiPrefix: z.string().max(20).nullable().optional(),
  }),
);

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
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    }),
);

export const ListApiKeysQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environment: ProjectEnvironmentSchema.optional(),
    isActive: z.coerce.boolean().optional(),
    includeInactive: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
  }),
);

export const CreateApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environment: ProjectEnvironmentSchema,
    name: z.string().min(1).max(255).nullable().optional(),
    expiresAt: OptionalDateSchema,
  }),
);

export const UpdateApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z
    .object({
      name: z.string().min(1).max(255).nullable().optional(),
      expiresAt: OptionalDateSchema,
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    }),
);

export const RotateApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    name: z.string().min(1).max(255).nullable().optional(),
    expiresAt: OptionalDateSchema,
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
  }),
);

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type ProjectEnvironment = z.infer<typeof ProjectEnvironmentSchema>;
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;
export type ListApiKeysQuery = z.infer<typeof ListApiKeysQuerySchema>;
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBodySchema>;
export type UpdateApiKeyBody = z.infer<typeof UpdateApiKeyBodySchema>;
export type RotateApiKeyBody = z.infer<typeof RotateApiKeyBodySchema>;

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
}

export interface ProjectWithStats extends Project {
  stats: ProjectStats;
}

export interface ProjectApiKey {
  id: string;
  projectId: string;
  keyPrefix: string;
  environment: ProjectEnvironment;
  name: string | null;
  isActive: boolean;
  createdBy: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ProjectApiKeyRecord extends ProjectApiKey {
  keyHash: string;
}

export interface CreateApiKeyResponse {
  apiKey: ProjectApiKey;
  fullKey: string;
}

export interface ApiKeyUsage {
  keyId: string;
  keyPrefix: string;
  totalRequests: number;
  lastUsedAt: Date | null;
  requestsByDay: Array<{
    date: string;
    count: number;
  }>;
}

export interface OrganizationMembership {
  orgId: string;
  userId: string;
  role: OrgRole;
  isActive: boolean;
}
