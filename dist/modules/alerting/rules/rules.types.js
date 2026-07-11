import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema } from '../common.js';
import { AppError } from '../../../shared/errors/app-error.js';
export { AlertSeveritySchema } from '../common.js';
export const ConditionTypeSchema = z.enum(['threshold', 'change', 'anomaly', 'static', 'composite']);
export const ConditionOperatorSchema = z.enum([
    'gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'contains', 'regex', 'in', 'exists',
]);
export const ActionTypeSchema = z.enum(['notify', 'webhook', 'suppress', 'escalate', 'group']);
export const AGGREGATE_FUNCTIONS = ['avg', 'sum', 'count', 'max', 'min', 'p99'];
export const RuleConditionSchema = z.object({
    conditionType: ConditionTypeSchema.default('threshold'),
    conditionGroupId: UuidSchema.optional(),
    fieldPath: z.string().min(1).max(500),
    operator: ConditionOperatorSchema,
    thresholdValue: z.unknown().optional(),
    lookbackMinutes: z.number().int().min(0).optional(),
    aggregateFunction: z.enum(AGGREGATE_FUNCTIONS).optional(),
    isRequired: z.boolean().default(true),
    orderIndex: z.number().int().min(0).default(0),
});
export const RuleActionSchema = z.object({
    actionType: ActionTypeSchema.default('notify'),
    priority: z.number().int().default(100),
    orderIndex: z.number().int().min(0).default(0),
    connectorId: UuidSchema.optional(),
    routeId: UuidSchema.optional(),
    templateId: UuidSchema.optional(),
    escalationPolicyId: UuidSchema.optional(),
    throttleDurationSeconds: z.number().int().min(0).default(0),
    maxNotificationsPerHour: z.number().int().min(1).optional(),
    actionConditions: z.record(z.string(), z.unknown()).default({}),
    isActive: z.boolean().default(true),
});
export const CreateRuleSchema = z.object({
    name: z.string().min(1).max(255).trim(),
    description: z.string().max(2000).optional(),
    severity: AlertSeveritySchema.default('warning'),
    enabled: z.boolean().default(true),
    evaluationIntervalSeconds: z.number().int().min(1).max(86_400).default(60),
    cooldownSeconds: z.number().int().min(0).max(86_400).default(300),
    autoResolveAfterMinutes: z.number().int().min(1).max(20_160).optional(),
    deduplicationWindowSeconds: z.number().int().min(0).max(604_800).default(3600),
    deduplicationKeyTemplate: z.string().max(500).optional(),
    groupingEnabled: z.boolean().default(false),
    groupingKeyTemplate: z.string().max(500).optional(),
    groupingWaitSeconds: z.number().int().min(0).max(3600).default(300),
    labels: z.record(z.string(), z.unknown()).default({}),
    annotations: z.record(z.string(), z.unknown()).default({}),
    metadata: z.record(z.string(), z.unknown()).default({}),
    conditions: z.array(RuleConditionSchema).max(50).default([]),
    actions: z.array(RuleActionSchema).max(50).default([]),
});
export const UpdateRuleSchema = CreateRuleSchema.partial().omit({ conditions: true, actions: true }).extend({
    conditions: z.array(RuleConditionSchema).max(50).optional(),
    actions: z.array(RuleActionSchema).max(50).optional(),
});
export const ListRulesQuerySchema = PaginationSchema.extend({
    enabled: z.coerce.boolean().optional(),
    severity: AlertSeveritySchema.optional(),
    search: z.string().max(255).optional(),
});
export const TestRuleSchema = z.object({
    payload: z.record(z.string(), z.unknown()),
});
export const OrgRuleParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema });
//# sourceMappingURL=rules.types.js.map