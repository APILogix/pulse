import { z } from "zod";
import { normalizeObjectKeys, OptionalDateSchema } from "../shared/schema-utils.js";
import { type ProjectEnvironment, ProjectEnvironmentSchema } from "../environments/environment.types.js";

export const ApiKeyStatusSchema = z.enum([
  "active",
  "revoked",
  "expired",
  "rotated",
  "suspended",
]);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

export const ApiKeyTypeSchema = z.enum([
  "standard",
  "read_only",
  "admin",
  "ingestion_only",
]);
export type ApiKeyType = z.infer<typeof ApiKeyTypeSchema>;

export const ApiKeyPermissionSchema = z.enum([
  "ingest:write",
  "ingest:read",
  "events:read",
  "metrics:read",
  "config:read",
]);
export type ApiKeyPermission = z.infer<typeof ApiKeyPermissionSchema>;

export const ApiKeyParamsSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  apiKeyId: z.string().uuid(),
});

export const ListApiKeysQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environment: ProjectEnvironmentSchema.optional(),
    keyType: ApiKeyTypeSchema.optional(),
    status: ApiKeyStatusSchema.optional(),
    isActive: z.coerce.boolean().optional(),
    includeInactive: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
  }),
);
export type ListApiKeysQuery = z.infer<typeof ListApiKeysQuerySchema>;

export const CreateApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environment: ProjectEnvironmentSchema,
    name: z.string().min(1).max(255).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    keyType: ApiKeyTypeSchema.default("standard"),
    expiresAt: OptionalDateSchema,
    autoRotateEnabled: z.coerce.boolean().optional(),
    autoRotateDays: z.coerce.number().int().min(1).max(365).optional(),
    permissions: z.array(ApiKeyPermissionSchema).min(1).max(20).optional(),
    allowedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
    blockedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
    rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).nullable().optional(),
    rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).nullable().optional(),
  }),
);
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBodySchema>;

export const UpdateApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z
    .object({
      name: z.string().min(1).max(255).nullable().optional(),
      description: z.string().max(2000).nullable().optional(),
      expiresAt: OptionalDateSchema,
      autoRotateEnabled: z.coerce.boolean().optional(),
      autoRotateDays: z.coerce.number().int().min(1).max(365).optional(),
      permissions: z.array(ApiKeyPermissionSchema).min(1).max(20).optional(),
      allowedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
      blockedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
      rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
      rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).nullable().optional(),
      rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    }),
);
export type UpdateApiKeyBody = z.infer<typeof UpdateApiKeyBodySchema>;

export const RotateApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    name: z.string().min(1).max(255).nullable().optional(),
    expiresAt: OptionalDateSchema,
    rotationReason: z.string().min(1).max(500).optional(),
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
  }),
);
export type RotateApiKeyBody = z.infer<typeof RotateApiKeyBodySchema>;

export const RevokeApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    revokedReason: z.string().min(1).max(500).optional(),
  }),
);
export type RevokeApiKeyBody = z.infer<typeof RevokeApiKeyBodySchema>;

export const BulkRotateBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environment: ProjectEnvironmentSchema.optional(),
    rotationReason: z.string().min(1).max(500).optional(),
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
  }),
);
export type BulkRotateBody = z.infer<typeof BulkRotateBodySchema>;

export const BulkRevokeBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environment: ProjectEnvironmentSchema.optional(),
    apiKeyIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    revokedReason: z.string().min(1).max(500).optional(),
  }),
);
export type BulkRevokeBody = z.infer<typeof BulkRevokeBodySchema>;


export interface ProjectApiKey {
  id: string;
  projectId: string;
  orgId: string | null;
  keyPrefix: string;
  keyType: ApiKeyType;
  environment: ProjectEnvironment;
  name: string | null;
  description: string | null;
  isActive: boolean;
  status: ApiKeyStatus;
  createdBy: string | null;
  rotatedFromKeyId: string | null;
  rotatedAt: Date | null;
  rotatedBy: string | null;
  rotationReason: string | null;
  gracePeriodEndsAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokedReason: string | null;
  expiresAt: Date | null;
  autoRotateEnabled: boolean;
  autoRotateDays: number;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  usageCount: number;
  errorCount: number;
  rateLimitPerSecond: number | null;
  rateLimitPerMinute: number | null;
  rateLimitPerHour: number | null;
  permissions: string[];
  allowedEndpoints: string[];
  blockedEndpoints: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectApiKeyRecord extends ProjectApiKey {
  keyHash: string;
}

export interface CreateApiKeyResponse {
  apiKey: ProjectApiKey;
  fullKey: string;
}

export interface ValidatedApiKey {
  id: string;
  projectId: string;
  orgId: string;
  environment: ProjectEnvironment;
  keyType: ApiKeyType;
  permissions: string[];
  allowedEndpoints: string[];
  blockedEndpoints: string[];
  rateLimitPerSecond: number | null;
  rateLimitPerMinute: number | null;
  rateLimitPerHour: number | null;
}

export interface ApiKeyUsage {
  keyId: string;
  keyPrefix: string;
  totalRequests: number;
  totalSuccess: number;
  totalErrors: number;
  bytesIngested: number;
  eventsIngested: number;
  lastUsedAt: Date | null;
  requestsByDay: Array<{ date: string; count: number }>;
}

export interface BulkOperationResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    apiKeyId: string;
    status: "ok" | "error";
    newKeyId?: string;
    reason?: string;
  }>;
}

export interface ApiKeyUpdateInput {
  name?: string | null;
  description?: string | null;
  expiresAt?: Date | null;
  autoRotateEnabled?: boolean;
  autoRotateDays?: number;
  permissions?: string[];
  allowedEndpoints?: string[];
  blockedEndpoints?: string[];
  rateLimitPerSecond?: number | null;
  rateLimitPerMinute?: number | null;
  rateLimitPerHour?: number | null;
}
