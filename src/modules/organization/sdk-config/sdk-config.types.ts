import { z } from "zod";
import type { SchemaV1Config } from "../../projects/sdk-config/schema-v1.js";
import { extractEditableConfig } from "../../projects/sdk-config/editable-view.js";
import { CursorPaginationSchema } from "../shared/types.js";

const Uuid = z.string().uuid();
const EditableConfigSchema = z.record(z.string(), z.unknown());

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

const ChangeSummarySchema = z.string().max(2000).optional();
export interface UpdateSdkConfigBody {
  editableConfig: Record<string, unknown>;
  changeSummary?: string;
}

/** Current admin write contract: protected identity, topology, meta, and entitlements are compiler-owned. */
const EditableUpdateSdkConfigSchema = z.object({
  editableConfig: EditableConfigSchema,
  changeSummary: ChangeSummarySchema,
}).strict();

/**
 * Compatibility for older UI/API callers that submit the delivered full SDK
 * document as `{ schemaVersion, configValue }`. We still publish only editable
 * intent; compiler-owned fields are projected out before mutation validation.
 */
const FullConfigValueUpdateSdkConfigSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  configValue: z.record(z.string(), z.unknown()),
  changeSummary: ChangeSummarySchema,
}).strict().transform((body) => ({
  editableConfig: extractEditableConfig(body.configValue as unknown as SchemaV1Config),
  ...(body.changeSummary !== undefined ? { changeSummary: body.changeSummary } : {}),
}));

/** Compatibility for callers that submit the complete schema-v1 document directly. */
const DirectFullConfigUpdateSdkConfigSchema = z.record(z.string(), z.unknown()).transform((body, ctx) => {
  if (body.editableConfig !== undefined || body.configValue !== undefined || body.schemaVersion !== 1) {
    ctx.addIssue({
      code: "custom",
      message: "Expected { editableConfig } or { schemaVersion: 1, configValue }",
    });
    return z.NEVER;
  }
  return { editableConfig: extractEditableConfig(body as unknown as SchemaV1Config) };
});

export const UpdateSdkConfigSchema = z.union([
  EditableUpdateSdkConfigSchema,
  FullConfigValueUpdateSdkConfigSchema,
  DirectFullConfigUpdateSdkConfigSchema,
]).pipe(z.object({
  editableConfig: EditableConfigSchema,
  changeSummary: ChangeSummarySchema,
}).strict());

export const RollbackSdkConfigSchema = z.object({
  toRevision: z.number().int().min(1),
  reason: z.string().min(1).max(2000),
}).strict();

export const ResolveSdkConfigQuerySchema = z.object({ environmentId: Uuid }).strict();

export type SdkConfigChangeType = "initial" | "publish" | "rollback";

export interface SdkConfigRow {
  id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  environment_name: string;
  environment_slug: string;
  published_revision_id: string;
  current_revision: number;
  current_hash: string;
  schema_version: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
  compiled_snapshot: SchemaV1Config;
  published_at: Date;
}

export interface SdkConfigVersionRow {
  id: string;
  config_id: string;
  organization_id: string;
  project_id: string;
  environment_id: string;
  environment_name: string;
  environment_slug: string;
  revision_number: number;
  compiled_snapshot: SchemaV1Config;
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
  environmentName: string;
  environmentSlug: string;
  publishedRevisionId: string;
  revision: number;
  revisionHash: string;
  compiledSnapshot: SchemaV1Config;
  schemaVersion: 1;
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
  environmentName: string;
  environmentSlug: string;
  revision: number;
  revisionHash: string;
  compiledSnapshot: SchemaV1Config;
  schemaVersion: 1;
  changeType: SdkConfigChangeType;
  changeSummary: string | null;
  rolledBackToRevision: number | null;
  publishedBy: string | null;
  publishedAt: Date;
}

export interface SdkConfigResolvedDto {
  environmentId: string;
  environmentName: string;
  environmentSlug: string;
  revision: number;
  revisionHash: string;
  schemaVersion: 1;
  compiledSnapshot: SchemaV1Config;
  publishedAt: Date;
}
