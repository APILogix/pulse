import { z } from 'zod';
export declare const AlertingWorkspaceParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const AlertingPolicyParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    policyId: z.ZodString;
}, z.core.$strip>;
export declare const AlertingEscalationParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    policyId: z.ZodString;
}, z.core.$strip>;
export declare const CreateAlertingPolicySchema: z.ZodObject<{
    slug: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    category: z.ZodString;
    severity: z.ZodEnum<{
        critical: "critical";
        error: "error";
        info: "info";
        warning: "warning";
    }>;
    metricSource: z.ZodString;
    expression: z.ZodString;
    defaultThreshold: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    recoveryThreshold: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    cooldownSeconds: z.ZodNumber;
    evaluationWindowSeconds: z.ZodNumber;
    documentation: z.ZodDefault<z.ZodString>;
    dependencies: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const CreateAlertingPolicyVersionSchema: z.ZodObject<{
    definition: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
export declare const UpdateAlertingSettingsSchema: z.ZodObject<{
    timezone: z.ZodOptional<z.ZodString>;
    defaultEvaluationWindowSeconds: z.ZodOptional<z.ZodNumber>;
    defaultCooldownSeconds: z.ZodOptional<z.ZodNumber>;
    retentionDays: z.ZodOptional<z.ZodNumber>;
    defaultSeverity: z.ZodOptional<z.ZodEnum<{
        critical: "critical";
        error: "error";
        info: "info";
        warning: "warning";
    }>>;
    defaultRoutingKey: z.ZodOptional<z.ZodString>;
    maximumIncidentAgeSeconds: z.ZodOptional<z.ZodNumber>;
    digestDefaults: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>;
export declare const UpdateMaintenanceConfigSchema: z.ZodObject<{
    timezone: z.ZodOptional<z.ZodString>;
    suppressionEnabled: z.ZodOptional<z.ZodBoolean>;
    recurringSupportEnabled: z.ZodOptional<z.ZodBoolean>;
    defaultSuppressionSettings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>;
export declare const UpdateNotificationDefaultsSchema: z.ZodObject<{
    emailEnabled: z.ZodOptional<z.ZodBoolean>;
    digestEnabled: z.ZodOptional<z.ZodBoolean>;
    businessHours: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    quietHours: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    fallbackBehavior: z.ZodOptional<z.ZodEnum<{
        email: "email";
        dashboard: "dashboard";
        drop: "drop";
    }>>;
}, z.core.$strict>;
export declare const UpdateRoutingDefaultSchema: z.ZodObject<{
    severity: z.ZodEnum<{
        critical: "critical";
        low: "low";
        medium: "medium";
        high: "high";
    }>;
    destinationType: z.ZodEnum<{
        email: "email";
        dashboard: "dashboard";
        none: "none";
    }>;
    isEnabled: z.ZodOptional<z.ZodBoolean>;
    config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const PaginationSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
//# sourceMappingURL=alerting-workspace.schemas.d.ts.map