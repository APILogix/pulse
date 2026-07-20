import { z } from "zod";
import { normalizeObjectKeys, OptionalDateSchema, Ipv4OrV6 } from "../shared/schema-utils.js";
import type { EnvironmentReference } from "../environments/environment.types.js";

export const ApiKeyStatusSchema = z.enum([
  "active",
  "revoked",
  "expired",
  "rotated",
  "suspended",
]);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

export const ApiKeyTypeSchema = z.enum([
  "read_write",
  "read_only",
  "write_only",
  "temporary",
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

export const ApiKeyRotationStateSchema = z.enum([
  "none",
  "rotating",
  "grace_period",
  "completed",
]);
export type ApiKeyRotationState = z.infer<typeof ApiKeyRotationStateSchema>;

export const ApiKeyParamsSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  apiKeyId: z.string().uuid(),
});

export const ListApiKeysQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environmentId: z.string().uuid().optional(),
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
    environmentId: z.string().uuid(),
    name: z.string().min(1).max(255).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    keyType: ApiKeyTypeSchema.default("read_write"),
    expiresAt: OptionalDateSchema,
    autoRotateEnabled: z.coerce.boolean().optional(),
    autoRotateDays: z.coerce.number().int().min(1).max(365).optional(),
    permissions: z.array(ApiKeyPermissionSchema).min(1).max(20).optional(),
    allowedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
    blockedEndpoints: z.array(z.string().min(1).max(255)).max(100).optional(),
    allowedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
    allowedOrigins: z.array(z.string().min(1).max(255)).max(100).optional(),
    allowedIps: z.array(Ipv4OrV6).max(256).optional(),
    allowedDomains: z.array(z.string().min(1).max(255)).max(100).optional(),
    samplingRules: z.record(z.string(), z.unknown()).optional(),
    featureFlags: z.record(z.string(), z.unknown()).optional(),
    sdkConfig: z.record(z.string(), z.unknown()).optional(),
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
      allowedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
      allowedOrigins: z.array(z.string().min(1).max(255)).max(100).optional(),
      allowedIps: z.array(Ipv4OrV6).max(256).optional(),
      allowedDomains: z.array(z.string().min(1).max(255)).max(100).optional(),
      samplingRules: z.record(z.string(), z.unknown()).optional(),
      featureFlags: z.record(z.string(), z.unknown()).optional(),
      sdkConfig: z.record(z.string(), z.unknown()).optional(),
      rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
      rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).nullable().optional(),
      rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).nullable().optional(),
      version: z.number().int().min(1).optional(),
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
    environmentId: z.string().uuid().optional(),
    rotationReason: z.string().min(1).max(500).optional(),
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
  }),
);
export type BulkRotateBody = z.infer<typeof BulkRotateBodySchema>;

export const BulkRevokeBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environmentId: z.string().uuid().optional(),
    apiKeyIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    revokedReason: z.string().min(1).max(500).optional(),
  }),
);
export type BulkRevokeBody = z.infer<typeof BulkRevokeBodySchema>;

export interface ProjectApiKey {
  id: string;
  projectId: string;
  orgId: string | null;
  publicKey: string;
  keyType: ApiKeyType;
  environmentId: string;
  environment: EnvironmentReference | null;
  name: string | null;
  description: string | null;
  isActive: boolean;
  status: ApiKeyStatus;
  rotationState: ApiKeyRotationState;
  rotationVersion: number;
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
  allowedEventTypes: string[];
  allowedOrigins: string[];
  allowedIps: string[];
  allowedDomains: string[];
  allowedSdks: string[];
  samplingRules: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
  sdkConfig: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ProjectApiKeyRecord extends ProjectApiKey {
  secretHash: string;
}

export interface CreateApiKeyResponse {
  apiKey: ProjectApiKey;
  fullKey: string;
}

export interface ValidatedApiKey {
  id: string;
  projectId: string;
  orgId: string;
  environmentId: string;
  environmentName: string;
  keyType: ApiKeyType;
  permissions: string[];
  allowedEndpoints: string[];
  blockedEndpoints: string[];
  allowedEventTypes: string[];
  allowedOrigins: string[];
  allowedIps: string[];
  allowedDomains: string[];
  allowedSdks: string[];
  rateLimitPerSecond: number | null;
  rateLimitPerMinute: number | null;
  rateLimitPerHour: number | null;
  samplingRules: Record<string, unknown>;
  featureFlags: Record<string, unknown>;
  sdkConfig: Record<string, unknown>;
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
  allowedEventTypes?: string[];
  allowedOrigins?: string[];
  allowedIps?: string[];
  allowedDomains?: string[];
  samplingRules?: Record<string, unknown>;
  featureFlags?: Record<string, unknown>;
  sdkConfig?: Record<string, unknown>;
  rateLimitPerSecond?: number | null;
  rateLimitPerMinute?: number | null;
  rateLimitPerHour?: number | null;
  version?: number;
}
