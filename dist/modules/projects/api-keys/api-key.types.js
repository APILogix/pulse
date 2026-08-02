import { z } from "zod";
import { normalizeObjectKeys, OptionalDateSchema } from "../shared/schema-utils.js";
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
/** Rotation workflow state is owned by `project_api_key_rotations`. */
export const ApiKeyRotationStateSchema = z.enum([
    "rotating",
    "grace_period",
    "completed",
]);
export const ApiKeyUsageGranularitySchema = z.enum(["hourly", "daily", "monthly"]);
export const ApiKeyParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
    apiKeyId: z.string().uuid(),
});
export const ListApiKeysQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    environmentId: z.string().uuid().optional(),
    status: ApiKeyStatusSchema.optional(),
    includeInactive: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
}).strict());
export const CreateApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environmentId: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
    expiresAt: OptionalDateSchema,
}).strict());
export const UpdateApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z
    .object({
    name: z.string().trim().min(1).max(255).optional(),
    expiresAt: OptionalDateSchema,
    /** Move this credential to a different environment within the same project. */
    environmentId: z.string().uuid().optional(),
})
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
export const RotateApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    name: z.string().trim().min(1).max(255).optional(),
    expiresAt: OptionalDateSchema,
    rotationReason: z.string().min(1).max(500).optional(),
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
}).strict());
export const RevokeApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    revokedReason: z.string().min(1).max(500).optional(),
}).strict());
export const BulkRotateBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environmentId: z.string().uuid().optional(),
    rotationReason: z.string().min(1).max(500).optional(),
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
}).strict());
export const BulkRevokeBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environmentId: z.string().uuid().optional(),
    apiKeyIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    revokedReason: z.string().min(1).max(500).optional(),
}).strict());
export const ApiKeyUsageQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    granularity: ApiKeyUsageGranularitySchema.default("daily"),
}).refine((value) => value.to >= value.from, {
    message: "to must be after from",
    path: ["to"],
}));
//# sourceMappingURL=api-key.types.js.map