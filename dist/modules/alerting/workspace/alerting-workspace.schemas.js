import { z } from 'zod';
export const AlertingWorkspaceParamsSchema = z.object({ orgId: z.string().uuid() });
export const AlertingPolicyParamsSchema = z.object({ orgId: z.string().uuid(), policyId: z.string().uuid() });
export const AlertingEscalationParamsSchema = z.object({ orgId: z.string().uuid(), policyId: z.string().uuid() });
export const CreateAlertingPolicySchema = z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(150),
    name: z.string().min(1).max(255),
    description: z.string().min(1).max(5000),
    category: z.string().min(1).max(100),
    severity: z.enum(['info', 'warning', 'error', 'critical']),
    metricSource: z.string().min(1).max(255),
    expression: z.string().min(1).max(5000),
    defaultThreshold: z.record(z.string(), z.unknown()),
    recoveryThreshold: z.record(z.string(), z.unknown()).default({}),
    cooldownSeconds: z.number().int().min(0).max(31536000),
    evaluationWindowSeconds: z.number().int().min(1).max(31536000),
    documentation: z.string().max(10000).default(''),
    dependencies: z.array(z.string().max(150)).max(50).default([]),
});
export const CreateAlertingPolicyVersionSchema = z.object({
    definition: z.record(z.string(), z.unknown()),
});
export const UpdateAlertingSettingsSchema = z.object({
    timezone: z.string().min(1).max(100).optional(),
    defaultEvaluationWindowSeconds: z.number().int().min(1).max(31536000).optional(),
    defaultCooldownSeconds: z.number().int().min(0).max(31536000).optional(),
    retentionDays: z.number().int().min(1).max(3650).optional(),
    defaultSeverity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
    defaultRoutingKey: z.string().min(1).max(100).optional(),
    maximumIncidentAgeSeconds: z.number().int().min(1).max(31536000).optional(),
    digestDefaults: z.record(z.string(), z.unknown()).optional(),
}).strict();
export const UpdateMaintenanceConfigSchema = z.object({
    timezone: z.string().min(1).max(100).optional(),
    suppressionEnabled: z.boolean().optional(),
    recurringSupportEnabled: z.boolean().optional(),
    defaultSuppressionSettings: z.record(z.string(), z.unknown()).optional(),
}).strict();
export const UpdateNotificationDefaultsSchema = z.object({
    emailEnabled: z.boolean().optional(),
    digestEnabled: z.boolean().optional(),
    businessHours: z.record(z.string(), z.unknown()).optional(),
    quietHours: z.record(z.string(), z.unknown()).optional(),
    fallbackBehavior: z.enum(['dashboard', 'email', 'drop']).optional(),
}).strict();
export const UpdateRoutingDefaultSchema = z.object({
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    destinationType: z.enum(['email', 'dashboard', 'none']),
    isEnabled: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
});
export const PaginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});
//# sourceMappingURL=alerting-workspace.schemas.js.map