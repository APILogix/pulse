/**
 * Alerting module — types, Zod schemas, DB row types, DTOs, and errors.
 *
 * Conventions (matching connectors/organization modules):
 *   - Zod schemas drive request validation and enum parity with Postgres.
 *   - DB rows are snake_case; response DTOs are camelCase.
 *   - Module errors extend the shared AppError for uniform HTTP mapping.
 *   - Enums match migrations2/003_add_alerting_module.up.sql exactly.
 */
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
// ════════════════════════════════════════════════════════════════════════
// ENUMS
// ════════════════════════════════════════════════════════════════════════
export const AlertSeveritySchema = z.enum(['info', 'warning', 'error', 'critical']);
export const AlertEventStatusSchema = z.enum([
    'pending', 'processing', 'firing', 'resolved', 'acknowledged', 'suppressed', 'silenced', 'error',
]);
export const ConditionTypeSchema = z.enum(['threshold', 'change', 'anomaly', 'static', 'composite']);
export const ConditionOperatorSchema = z.enum([
    'gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'contains', 'regex', 'in', 'exists',
]);
export const ActionTypeSchema = z.enum(['notify', 'webhook', 'suppress', 'escalate', 'group']);
export const DeliveryAttemptStatusSchema = z.enum([
    'pending', 'queued', 'sent', 'delivered', 'failed', 'retrying', 'cancelled',
]);
export const BatchStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'partial']);
export const HistoryActionSchema = z.enum([
    'triggered', 'acknowledged', 'resolved', 'escalated', 'suppressed', 'notified',
    'silenced', 'grouped', 'auto_resolved', 'rule_modified',
]);
export const MetricGranularitySchema = z.enum(['hour', 'day', 'week', 'month']);
export const AGGREGATE_FUNCTIONS = ['avg', 'sum', 'count', 'max', 'min', 'p99'];
// ════════════════════════════════════════════════════════════════════════
// COMMON PARAM / PAGINATION SCHEMAS
// ════════════════════════════════════════════════════════════════════════
export const UuidSchema = z.string().uuid();
export const OrgIdParamsSchema = z.object({ orgId: UuidSchema });
export const OrgRuleParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema });
export const OrgEventParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema });
export const OrgPolicyParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema });
export const OrgPolicyStepParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema, stepId: UuidSchema });
export const PaginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    sortBy: z.string().max(50).optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
// ════════════════════════════════════════════════════════════════════════
// RULE SCHEMAS
// ════════════════════════════════════════════════════════════════════════
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
// ════════════════════════════════════════════════════════════════════════
// EVENT INGESTION + LIFECYCLE SCHEMAS
// ════════════════════════════════════════════════════════════════════════
export const IngestEventSchema = z.object({
    ruleId: UuidSchema.optional(),
    severity: AlertSeveritySchema,
    source: z.string().min(1).max(100),
    sourceId: z.string().max(255).optional(),
    payload: z.record(z.string(), z.unknown()),
    labels: z.record(z.string(), z.unknown()).default({}),
    annotations: z.record(z.string(), z.unknown()).default({}),
    fingerprint: z.string().max(255).optional(),
});
export const ListEventsQuerySchema = PaginationSchema.extend({
    status: AlertEventStatusSchema.optional(),
    severity: AlertSeveritySchema.optional(),
    source: z.string().max(100).optional(),
    ruleId: UuidSchema.optional(),
});
export const AcknowledgeEventSchema = z.object({
    comment: z.string().max(2000).optional(),
    expiresInMinutes: z.number().int().min(1).max(20_160).optional(),
});
export const ResolveEventSchema = z.object({
    reason: z.string().max(100).optional(),
    comment: z.string().max(2000).optional(),
});
// ════════════════════════════════════════════════════════════════════════
// SILENCE SCHEMAS
// ════════════════════════════════════════════════════════════════════════
export const CreateSilenceSchema = z.object({
    ruleId: UuidSchema.optional(),
    comment: z.string().max(2000).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    matchers: z.record(z.string(), z.unknown()).default({}),
}).refine((s) => s.endsAt > s.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });
export const SilenceFromEventSchema = z.object({
    durationMinutes: z.number().int().min(1).max(20_160).default(60),
    comment: z.string().max(2000).optional(),
});
export const ListSilencesQuerySchema = PaginationSchema.extend({
    active: z.coerce.boolean().optional(),
});
// ════════════════════════════════════════════════════════════════════════
// ESCALATION SCHEMAS
// ════════════════════════════════════════════════════════════════════════
export const CreateEscalationPolicySchema = z.object({
    name: z.string().min(1).max(255).trim(),
    description: z.string().max(2000).optional(),
    repeatIntervalMinutes: z.number().int().min(1).max(10_080).optional(),
    maxRepeats: z.number().int().min(0).max(100).default(0),
    isActive: z.boolean().default(true),
});
export const UpsertEscalationStepSchema = z.object({
    stepNumber: z.number().int().min(1).max(100),
    waitMinutes: z.number().int().min(0).max(10_080).default(5),
    connectorIds: z.array(UuidSchema).max(50).default([]),
    routeIds: z.array(UuidSchema).max(50).default([]),
    notifyOnCall: z.boolean().default(false),
    customMessageTemplate: z.string().max(4000).optional(),
    templateId: UuidSchema.optional(),
    isActive: z.boolean().default(true),
});
// ════════════════════════════════════════════════════════════════════════
// TEMPLATE SCHEMAS
// ════════════════════════════════════════════════════════════════════════
export const CreateTemplateSchema = z.object({
    name: z.string().min(1).max(255).trim(),
    templateType: z.string().min(1).max(50).default('body'),
    content: z.string().min(1).max(20_000),
    variablesSchema: z.array(z.unknown()).default([]),
    defaultForSeverity: AlertSeveritySchema.optional(),
    connectorType: z.string().max(50).optional(),
    isDefault: z.boolean().default(false),
    sampleData: z.record(z.string(), z.unknown()).default({}),
});
export const UpdateTemplateSchema = CreateTemplateSchema.partial();
export const PreviewTemplateSchema = z.object({
    sampleData: z.record(z.string(), z.unknown()).optional(),
});
// ════════════════════════════════════════════════════════════════════════
// ROUTING RULE SCHEMAS
// ════════════════════════════════════════════════════════════════════════
export const RoutingConditionsSchema = z.object({
    severity: z.array(AlertSeveritySchema).optional(),
    source: z.array(z.string().max(100)).optional(),
    labels: z.record(z.string(), z.string()).optional(),
});
export const CreateRoutingRuleSchema = z.object({
    name: z.string().min(1).max(255).trim(),
    description: z.string().max(2000).optional(),
    priority: z.number().int().default(100),
    conditions: RoutingConditionsSchema.default({}),
    targetConnectorIds: z.array(UuidSchema).max(50).default([]),
    targetRouteIds: z.array(UuidSchema).max(50).default([]),
    fallbackConnectorIds: z.array(UuidSchema).max(50).default([]),
    templateId: UuidSchema.optional(),
    isActive: z.boolean().default(true),
});
export const UpdateRoutingRuleSchema = CreateRoutingRuleSchema.partial();
export const TestRoutingSchema = z.object({
    severity: AlertSeveritySchema,
    source: z.string().max(100),
    labels: z.record(z.string(), z.string()).default({}),
});
// ════════════════════════════════════════════════════════════════════════
// METRICS SCHEMAS
// ════════════════════════════════════════════════════════════════════════
export const MetricsQuerySchema = z.object({
    metricType: z.string().max(50).optional(),
    ruleId: UuidSchema.optional(),
    granularity: MetricGranularitySchema.default('hour'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(168),
});
// ════════════════════════════════════════════════════════════════════════
// ERROR CLASSES
// ════════════════════════════════════════════════════════════════════════
export class AlertError extends AppError {
    constructor(message, code = 'ALERT_ERROR', statusCode = 400, details) {
        super(message, code, statusCode, details);
    }
}
export class AlertNotFoundError extends AlertError {
    constructor(resource = 'Alert resource') {
        super(`${resource} not found`, 'ALERT_NOT_FOUND', 404);
    }
}
export class AlertConflictError extends AlertError {
    constructor(message) {
        super(message, 'ALERT_CONFLICT', 409);
    }
}
export class AlertValidationError extends AlertError {
    constructor(message, details) {
        super(message, 'ALERT_VALIDATION_ERROR', 422, details);
    }
}
//# sourceMappingURL=types.js.map