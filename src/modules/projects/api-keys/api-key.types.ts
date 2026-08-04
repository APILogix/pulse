import { z } from "zod";
import { normalizeObjectKeys, OptionalDateSchema } from "../shared/schema-utils.js";
import type { EnvironmentReference } from "../environments/environment.types.js";

/**
 * An API key is only an authentication credential: it answers "which
 * project/environment is sending this telemetry?". Rate limits, permissions,
 * network policy, SDK configuration, and analytics live in their own modules.
 */
export const ApiKeyStatusSchema = z.enum([
  "active",
  "revoked",
  "expired",
  "rotated",
  "suspended",
]);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

/** Rotation workflow state is owned by `project_api_key_rotations`. */
export const ApiKeyRotationStateSchema = z.enum([
  "rotating",
  "grace_period",
  "completed",
]);
export type ApiKeyRotationState = z.infer<typeof ApiKeyRotationStateSchema>;

export const ApiKeyUsageGranularitySchema = z.enum(["hourly", "daily", "monthly"]);
export type ApiKeyUsageGranularity = z.infer<typeof ApiKeyUsageGranularitySchema>;

export const ApiKeyParamsSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  apiKeyId: z.string().uuid(),
});

export const ListApiKeysQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environmentId: z.string().uuid().optional(),
    status: ApiKeyStatusSchema.optional(),
    includeInactive: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
  }).strict(),
);
export type ListApiKeysQuery = z.infer<typeof ListApiKeysQuerySchema>;

export const CreateApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environmentId: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
    expiresAt: OptionalDateSchema,
  }).strict(),
);
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBodySchema>;

export const UpdateApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z
    .object({
      name: z.string().trim().min(1).max(255).optional(),
      expiresAt: OptionalDateSchema,
      /** Move this credential to a different environment within the same project. */
      environmentId: z.string().uuid().optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    }),
);
export type UpdateApiKeyBody = z.infer<typeof UpdateApiKeyBodySchema>;

export const RotateApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    name: z.string().trim().min(1).max(255).optional(),
    expiresAt: OptionalDateSchema,
    rotationReason: z.string().min(1).max(500).optional(),
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
  }).strict(),
);
export type RotateApiKeyBody = z.infer<typeof RotateApiKeyBodySchema>;

export const RevokeApiKeyBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    revokedReason: z.string().min(1).max(500).optional(),
  }).strict(),
);
export type RevokeApiKeyBody = z.infer<typeof RevokeApiKeyBodySchema>;

export const BulkRotateBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environmentId: z.string().uuid().optional(),
    rotationReason: z.string().min(1).max(500).optional(),
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
  }).strict(),
);
export type BulkRotateBody = z.infer<typeof BulkRotateBodySchema>;

export const BulkRevokeBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    environmentId: z.string().uuid().optional(),
    apiKeyIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    revokedReason: z.string().min(1).max(500).optional(),
  }).strict(),
);
export type BulkRevokeBody = z.infer<typeof BulkRevokeBodySchema>;

export const ApiKeyUsageQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    granularity: ApiKeyUsageGranularitySchema.default("daily"),
  }).refine((value) => value.to >= value.from, {
    message: "to must be after from",
    path: ["to"],
  }),
);
export type ApiKeyUsageQuery = z.infer<typeof ApiKeyUsageQuerySchema>;

/** Canonical minimal credential. */
export interface ProjectApiKey {
  id: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  name: string;
  publicKey: string;
  status: ApiKeyStatus;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdBy: string | null;
  rotatedFromKeyId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Derived display data; never stored on the credential. */
  environment?: EnvironmentReference | null;
}

export interface ProjectApiKeyRecord extends ProjectApiKey {
  secretHash: string;
}

export interface CreateApiKeyResponse {
  apiKey: ProjectApiKey;
  fullKey: string;
}

export interface ApiKeyRotation {
  id: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  oldKeyId: string;
  newKeyId: string | null;
  state: ApiKeyRotationState;
  reason: string | null;
  initiatedBy: string | null;
  initiatedAt: Date;
  graceEndsAt: Date | null;
  completedAt: Date | null;
}

/**
 * Authentication context. Rate limits and ingestion policy are resolved from
 * organization/platform configuration, not from the credential row.
 */
export interface ValidatedApiKey {
  id: string;
  projectId: string;
  orgId: string;
  environmentId: string;
  environmentName: string;
  environmentSlug: string;
}

export interface ApiKeyUsageSeriesPoint {
  bucket: string;
  requests: number;
  acceptedEvents: number;
  errorEvents: number;
  ingestionFailures: number;
  acceptedBytes: number;
  rateLimitedRequests: number;
}

export interface ApiKeyUsageSummary {
  requests: number;
  acceptedEvents: number;
  errorEvents: number;
  ingestionFailures: number;
  acceptedBytes: number;
  rateLimitedRequests: number;
  errorRate: number;
}

export interface ApiKeyUsage {
  keyId: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  granularity: ApiKeyUsageGranularity;
  from: string;
  to: string;
  summary: ApiKeyUsageSummary;
  series: ApiKeyUsageSeriesPoint[];
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
  name?: string;
  expiresAt?: Date | null;
  environmentId?: string;
}
