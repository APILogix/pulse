import { z } from "zod";
import { normalizeObjectKeys } from "../../shared/schema-utils.js";
const UuidSchema = z.string().uuid();
const BooleanInputSchema = z.preprocess((value) => {
    if (value === "true" || value === "1")
        return true;
    if (value === "false" || value === "0")
        return false;
    return value;
}, z.boolean());
const THRESHOLD_ALIASES = {
    orgId: "org_id",
    projectId: "project_id",
    thresholdId: "threshold_id",
    environmentId: "environment_id",
    thresholdKey: "threshold_key",
    metricName: "metric_name",
    metricSource: "metric_source",
    comparisonOperator: "comparison_operator",
    thresholdValue: "threshold_value",
    thresholdUnit: "threshold_unit",
    evaluationWindowMinutes: "evaluation_window_minutes",
    cooldownMinutes: "cooldown_minutes",
    consecutiveBreaches: "consecutive_breaches",
    notifyOnRecovery: "notify_on_recovery",
};
/** Applies shared aliases first, then aliases owned by the threshold module. */
export function normalizeThresholdObjectKeys(value) {
    const normalized = normalizeObjectKeys(value);
    if (!normalized || typeof normalized !== "object" || Array.isArray(normalized))
        return normalized;
    const record = normalized;
    for (const [camel, snake] of Object.entries(THRESHOLD_ALIASES)) {
        if (record[camel] === undefined && record[snake] !== undefined)
            record[camel] = record[snake];
    }
    return record;
}
export const ThresholdComparisonOperatorSchema = z.enum([">", ">=", "<", "<=", "=", "!="]);
export const ProjectThresholdParamsSchema = z.preprocess(normalizeThresholdObjectKeys, z.object({ orgId: UuidSchema, projectId: UuidSchema }));
export const ThresholdDetailParamsSchema = z.preprocess(normalizeThresholdObjectKeys, z.object({ orgId: UuidSchema, projectId: UuidSchema, thresholdId: UuidSchema }));
export const ListThresholdsQuerySchema = z.preprocess(normalizeThresholdObjectKeys, z.object({
    environmentId: UuidSchema.nullable().optional(),
    enabled: BooleanInputSchema.optional(),
    category: z.string().trim().min(1).max(100).optional(),
    severity: z.string().trim().min(1).max(20).optional(),
    metricName: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "threshold_key", "metric_name"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
}));
const ThresholdMutationFields = {
    environmentId: UuidSchema.nullable().optional(),
    thresholdKey: z.string().trim().min(1).max(100),
    metricName: z.string().trim().min(1).max(100),
    metricSource: z.string().trim().min(1).max(100),
    category: z.string().trim().min(1).max(100),
    severity: z.string().trim().min(1).max(20),
    comparisonOperator: ThresholdComparisonOperatorSchema,
    thresholdValue: z.coerce.number().finite(),
    thresholdUnit: z.string().trim().min(1).max(50),
    evaluationWindowMinutes: z.coerce.number().int().positive(),
    cooldownMinutes: z.coerce.number().int().nonnegative(),
    consecutiveBreaches: z.coerce.number().int().positive(),
    enabled: BooleanInputSchema,
    notifyOnRecovery: BooleanInputSchema,
};
export const CreateThresholdBodySchema = z.preprocess(normalizeThresholdObjectKeys, z.object({
    ...ThresholdMutationFields,
    evaluationWindowMinutes: ThresholdMutationFields.evaluationWindowMinutes.default(5),
    cooldownMinutes: ThresholdMutationFields.cooldownMinutes.default(15),
    consecutiveBreaches: ThresholdMutationFields.consecutiveBreaches.default(1),
    enabled: ThresholdMutationFields.enabled.default(true),
    notifyOnRecovery: ThresholdMutationFields.notifyOnRecovery.default(true),
}));
export const UpdateThresholdBodySchema = z.preprocess(normalizeThresholdObjectKeys, z.object({
    environmentId: ThresholdMutationFields.environmentId,
    thresholdKey: ThresholdMutationFields.thresholdKey.optional(),
    metricName: ThresholdMutationFields.metricName.optional(),
    metricSource: ThresholdMutationFields.metricSource.optional(),
    category: ThresholdMutationFields.category.optional(),
    severity: ThresholdMutationFields.severity.optional(),
    comparisonOperator: ThresholdMutationFields.comparisonOperator.optional(),
    thresholdValue: ThresholdMutationFields.thresholdValue.optional(),
    thresholdUnit: ThresholdMutationFields.thresholdUnit.optional(),
    evaluationWindowMinutes: ThresholdMutationFields.evaluationWindowMinutes.optional(),
    cooldownMinutes: ThresholdMutationFields.cooldownMinutes.optional(),
    consecutiveBreaches: ThresholdMutationFields.consecutiveBreaches.optional(),
    enabled: ThresholdMutationFields.enabled.optional(),
    notifyOnRecovery: ThresholdMutationFields.notifyOnRecovery.optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" }));
export const ToggleThresholdBodySchema = z.preprocess(normalizeThresholdObjectKeys, z.object({ enabled: BooleanInputSchema }));
//# sourceMappingURL=threshold.types.js.map