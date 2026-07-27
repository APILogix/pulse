/** Environment-owned SDK configuration heads and immutable revisions. */
import { z } from "zod";
import { CursorPaginationSchema } from "../shared/types.js";

const Uuid = z.string().uuid();
const ConfigValueSchema = z.record(z.string(), z.unknown());

export const SdkConfigParamsSchema = z.object({ orgId: Uuid, configId: Uuid });
export const SdkConfigVersionParamsSchema = z.object({
  orgId: Uuid,
  configId: Uuid,
  version: z.coerce.number().int().min(1),
});

export const ListSdkConfigsQuerySchema = CursorPaginationSchema.extend({
  projectId: Uuid.optional(),
  environmentId: Uuid.optional(),
});

export const UpdateSdkConfigSchema = z.object({
  configValue: ConfigValueSchema,
  schemaVersion: z.string().max(50).nullable().optional(),
  changeSummary: z.string().max(2000).optional(),
});

export const RollbackSdkConfigSchema = z.object({
  toRevision: z.number().int().min(1),
  reason: z.string().min(1).max(2000),
});

export const ResolveSdkConfigQuerySchema = z.object({
  environmentId: Uuid,
});

export type SdkConfigChangeType = "initial" | "publish" | "rollback";

export interface SdkConfigRow {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  published_revision_id: string;
  current_revision: number;
  current_hash: string;
  schema_version: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
  config_value: Record<string, unknown>;
  published_at: Date;
}

export interface SdkConfigVersionRow {
  id: string;
  config_id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  revision_number: number;
  config_value: Record<string, unknown>;
  config_hash: string;
  schema_version: string | null;
  change_type: SdkConfigChangeType;
  change_summary: string | null;
  rolled_back_to_revision: number | null;
  published_by: string | null;
  published_at: Date;
}
export interface SdkConfigDto {
  id: string;
  orgId: string;
  projectId: string;
  environmentId: string;
  publishedRevisionId: string;
  revision: number;
  revisionHash: string;
  configValue: Record<string, unknown>;
  schemaVersion: string | null;
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface SdkConfigVersionDto {
  id: string;
  configId: string;
  orgId: string;
  projectId: string;
  environmentId: string;
  revision: number;
  revisionHash: string;
  configValue: Record<string, unknown>;
  schemaVersion: string | null;
  changeType: SdkConfigChangeType;
  changeSummary: string | null;
  rolledBackToRevision: number | null;
  publishedBy: string | null;
  publishedAt: Date;
}

/** Exact published document returned to every SDK in one environment. */
export interface SdkConfigResolvedDto {
  environmentId: string;
  revision: number;
  revisionHash: string;
  schemaVersion: string | null;
  configValue: Record<string, unknown>;
  publishedAt: Date;
}
