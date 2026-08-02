import { z } from "zod";
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
    editableConfig: extractEditableConfig(body.configValue),
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
    return { editableConfig: extractEditableConfig(body) };
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
//# sourceMappingURL=sdk-config.types.js.map