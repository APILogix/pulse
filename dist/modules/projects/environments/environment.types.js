import { z } from "zod";
import { normalizeObjectKeys, Ipv4OrV6 } from "../shared/schema-utils.js";
export const ProjectEnvironmentSchema = z.enum([
    "development",
    "staging",
    "production",
]);
export const EnvironmentParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
    environment: ProjectEnvironmentSchema,
});
export const environmentConfigShape = {
    isActive: z.coerce.boolean().optional(),
    rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).nullable().optional(),
    rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).nullable().optional(),
    burstLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    allowedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
    maxEventSizeBytes: z.coerce.number().int().min(1).max(67_108_864).nullable().optional(),
    maxBatchSize: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
    requireHttps: z.coerce.boolean().optional(),
    ipAllowlist: z.array(Ipv4OrV6).max(256).nullable().optional(),
    ipBlocklist: z.array(Ipv4OrV6).max(256).nullable().optional(),
    alertEmail: z.string().email().max(255).nullable().optional(),
    alertWebhookUrl: z.string().url().max(500).nullable().optional(),
};
export const CreateEnvironmentBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environment: ProjectEnvironmentSchema,
    ...environmentConfigShape,
}));
export const UpdateEnvironmentBodySchema = z.preprocess(normalizeObjectKeys, z
    .object(environmentConfigShape)
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
//# sourceMappingURL=environment.types.js.map