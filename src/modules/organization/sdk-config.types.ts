/**
 * SDK Remote Config types — DB rows, DTOs, and Zod validators.
 *
 * Mirrors migrations2/007_add_sdk_config_module.up.sql. Snake_case Row types
 * match columns; camelCase DTOs are what the API returns.
 */
import { z } from "zod";

// ═══════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════

export const ConfigTypeSchema = z.enum(["json", "yaml", "env", "feature_flag"]);
export type ConfigType = z.infer<typeof ConfigTypeSchema>;

export const DeploymentStatusSchema = z.enum([
  "pending",
  "deploying",
  "deployed",
  "failed",
  "rolled_back",
]);
export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;

export type ChangeType = "create" | "update" | "rollback" | "delete";

// ═══════════════════════════════════════════════════
// PARAM / QUERY / BODY SCHEMAS
// ═══════════════════════════════════════════════════

const Uuid = z.string().uuid();

export const SdkConfigParamsSchema = z.object({ orgId: Uuid, configId: Uuid });
export const SdkConfigVersionParamsSchema = z.object({
  orgId: Uuid,
  configId: Uuid,
  version: z.coerce.number().int().min(1),
});

export const ListSdkConfigsQuerySchema = z.object({
  projectId: Uuid.optional(),
  environment: z.string().max(50).optional(),
  configKey: z.string().max(255).optional(),
  includeInactive: z.coerce.boolean().optional(),
});

const ConfigValueSchema = z.record(z.string(), z.unknown());

export const CreateSdkConfigSchema = z.object({
  configKey: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._:-]+$/, "config_key may contain letters, numbers, . _ : -"),
  configValue: ConfigValueSchema,
  configType: ConfigTypeSchema.default("json"),
  projectId: Uuid.nullable().optional(),
  environment: z.string().min(1).max(50).default("all"),
  schemaVersion: z.string().max(50).optional(),
  targetSdkVersions: z.array(z.string().max(50)).max(100).optional(),
  targetPlatforms: z.array(z.string().max(50)).max(100).optional(),
  rolloutPercentage: z.number().int().min(0).max(100).default(100),
  isEncrypted: z.boolean().default(false),
});

export const UpdateSdkConfigSchema = z.object({
  configValue: ConfigValueSchema.optional(),
  environment: z.string().min(1).max(50).optional(),
  schemaVersion: z.string().max(50).nullable().optional(),
  targetSdkVersions: z.array(z.string().max(50)).max(100).nullable().optional(),
  targetPlatforms: z.array(z.string().max(50)).max(100).nullable().optional(),
  rolloutPercentage: z.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  changeSummary: z.string().max(2000).optional(),
});

export const RollbackSdkConfigSchema = z.object({
  toVersion: z.number().int().min(1),
  reason: z.string().min(1).max(2000),
});

export const ResolveSdkConfigQuerySchema = z.object({
  projectId: Uuid.optional(),
  environment: z.string().max(50).default("all"),
  platform: z.string().max(50).optional(),
  sdkVersion: z.string().max(50).optional(),
});

// ═══════════════════════════════════════════════════
// DB ROW TYPES
// ═══════════════════════════════════════════════════

export interface SdkConfigRow {
  id: string;
  org_id: string;
  project_id: string | null;
  config_key: string;
  config_type: ConfigType;
  version: number;
  version_hash: string;
  is_latest: boolean;
  config_value: Record<string, unknown>;
  schema_version: string | null;
  environment: string;
  target_sdk_versions: string[] | null;
  target_platforms: string[] | null;
  rollout_percentage: number;
  is_active: boolean;
  is_encrypted: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SdkConfigVersionRow {
  id: string;
  config_id: string;
  version: number;
  version_hash: string;
  config_value: Record<string, unknown>;
  config_value_encrypted: string | null;
  change_type: ChangeType;
  change_summary: string | null;
  change_diff: Record<string, unknown> | null;
  rolled_back_at: Date | null;
  rolled_back_by: string | null;
  rolled_back_to_version: number | null;
  created_by: string | null;
  created_at: Date;
}

export interface SdkConfigDeploymentRow {
  id: string;
  config_id: string;
  version: number;
  status: DeploymentStatus;
  rollout_percentage: number;
  target_count: number | null;
  reached_count: number;
  error_count: number;
  last_error: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ═══════════════════════════════════════════════════
// RESPONSE DTOs
// ═══════════════════════════════════════════════════

export interface SdkConfigDto {
  id: string;
  orgId: string;
  projectId: string | null;
  configKey: string;
  configType: ConfigType;
  version: number;
  versionHash: string;
  isLatest: boolean;
  configValue: Record<string, unknown>;
  schemaVersion: string | null;
  environment: string;
  targetSdkVersions: string[] | null;
  targetPlatforms: string[] | null;
  rolloutPercentage: number;
  isActive: boolean;
  isEncrypted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SdkConfigVersionDto {
  id: string;
  configId: string;
  version: number;
  versionHash: string;
  configValue: Record<string, unknown>;
  changeType: ChangeType;
  changeSummary: string | null;
  changeDiff: Record<string, unknown> | null;
  rolledBackAt: Date | null;
  rolledBackToVersion: number | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface SdkConfigDeploymentDto {
  id: string;
  configId: string;
  version: number;
  status: DeploymentStatus;
  rolloutPercentage: number;
  targetCount: number | null;
  reachedCount: number;
  errorCount: number;
  lastError: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Compact shape returned to SDKs on the runtime fetch path. */
export interface SdkConfigResolvedDto {
  configKey: string;
  configValue: Record<string, unknown>;
  version: number;
  versionHash: string;
  schemaVersion: string | null;
  environment: string;
  targetPlatforms: string[] | null;
}
