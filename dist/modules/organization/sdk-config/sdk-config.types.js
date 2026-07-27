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
//# sourceMappingURL=sdk-config.types.js.map