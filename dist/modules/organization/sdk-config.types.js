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
export const DeploymentStatusSchema = z.enum([
    "pending",
    "deploying",
    "deployed",
    "failed",
    "rolled_back",
]);
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
//# sourceMappingURL=sdk-config.types.js.map