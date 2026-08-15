import { z } from "zod";
/** Applies shared aliases first, then aliases owned by the threshold module. */
export declare function normalizeThresholdObjectKeys(value: unknown): unknown;
export declare const ThresholdComparisonOperatorSchema: z.ZodEnum<{
    "=": "=";
    "<": "<";
    ">": ">";
    ">=": ">=";
    "<=": "<=";
    "!=": "!=";
}>;
export type ThresholdComparisonOperator = z.infer<typeof ThresholdComparisonOperatorSchema>;
export declare const ProjectThresholdParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
}, z.core.$strip>>;
export declare const ThresholdDetailParamsSchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    thresholdId: z.ZodString;
}, z.core.$strip>>;
export declare const ListThresholdsQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environmentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    enabled: z.ZodOptional<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
    category: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodString>;
    metricName: z.ZodOptional<z.ZodString>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodDefault<z.ZodEnum<{
        created_at: "created_at";
        updated_at: "updated_at";
        threshold_key: "threshold_key";
        metric_name: "metric_name";
    }>>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>>;
export type ListThresholdsQuery = z.infer<typeof ListThresholdsQuerySchema>;
export declare const CreateThresholdBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    evaluationWindowMinutes: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    cooldownMinutes: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    consecutiveBreaches: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    enabled: z.ZodDefault<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
    notifyOnRecovery: z.ZodDefault<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
    environmentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    thresholdKey: z.ZodString;
    metricName: z.ZodString;
    metricSource: z.ZodString;
    category: z.ZodString;
    severity: z.ZodString;
    comparisonOperator: z.ZodEnum<{
        "=": "=";
        "<": "<";
        ">": ">";
        ">=": ">=";
        "<=": "<=";
        "!=": "!=";
    }>;
    thresholdValue: z.ZodCoercedNumber<unknown>;
    thresholdUnit: z.ZodString;
}, z.core.$strip>>;
export type CreateThresholdBody = z.infer<typeof CreateThresholdBodySchema>;
export declare const UpdateThresholdBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environmentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    thresholdKey: z.ZodOptional<z.ZodString>;
    metricName: z.ZodOptional<z.ZodString>;
    metricSource: z.ZodOptional<z.ZodString>;
    category: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodString>;
    comparisonOperator: z.ZodOptional<z.ZodEnum<{
        "=": "=";
        "<": "<";
        ">": ">";
        ">=": ">=";
        "<=": "<=";
        "!=": "!=";
    }>>;
    thresholdValue: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    thresholdUnit: z.ZodOptional<z.ZodString>;
    evaluationWindowMinutes: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    cooldownMinutes: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    consecutiveBreaches: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    enabled: z.ZodOptional<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
    notifyOnRecovery: z.ZodOptional<z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>>;
}, z.core.$strip>>;
export type UpdateThresholdBody = z.infer<typeof UpdateThresholdBodySchema>;
export declare const ToggleThresholdBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    enabled: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodBoolean>;
}, z.core.$strip>>;
export type ToggleThresholdBody = z.infer<typeof ToggleThresholdBodySchema>;
export interface ProjectAlertThreshold {
    id: string;
    organizationId: string;
    projectId: string;
    environmentId: string | null;
    thresholdKey: string;
    metricName: string;
    metricSource: string;
    category: string;
    severity: string;
    comparisonOperator: ThresholdComparisonOperator;
    thresholdValue: number;
    thresholdUnit: string;
    evaluationWindowMinutes: number;
    cooldownMinutes: number;
    consecutiveBreaches: number;
    enabled: boolean;
    notifyOnRecovery: boolean;
    lastTriggeredAt: Date | null;
    lastRecoveredAt: Date | null;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    version: number;
}
/** Canonical project_alert_thresholds result columns as returned by pg. */
export interface ProjectAlertThresholdRow {
    id: string;
    organization_id: string;
    project_id: string;
    environment_id: string | null;
    threshold_key: string;
    metric_name: string;
    metric_source: string;
    category: string;
    severity: string;
    comparison_operator: ThresholdComparisonOperator;
    threshold_value: string | number;
    threshold_unit: string;
    evaluation_window_minutes: number;
    cooldown_minutes: number;
    consecutive_breaches: number;
    enabled: boolean;
    notify_on_recovery: boolean;
    last_triggered_at: Date | null;
    last_recovered_at: Date | null;
    created_by: string | null;
    updated_by: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    version: number;
}
//# sourceMappingURL=threshold.types.d.ts.map