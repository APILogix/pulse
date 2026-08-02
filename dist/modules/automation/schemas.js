/**
 * Automation module – Zod v4 schemas for all public API inputs.
 *
 * Enforces: size/array/string limits, safe timezone/5-field cron,
 * project scope, risk/approval constraints, external webhook safety
 * metadata, JSON object shapes, and enum values.
 */
import { z } from 'zod';
import { WORKFLOW_TYPES, TRIGGER_TYPES, ACTION_TYPES, CONDITION_OPERATORS, TRIGGER_KINDS, WORKFLOW_STATUSES, WORKFLOW_SCOPES, ACTION_RISK_LEVELS, RUN_STATUSES, APPROVAL_STATUSES, LIMITS, } from './types.js';
// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
export const UuidSchema = z.string().uuid();
export const OrgIdParamsSchema = z.object({ orgId: UuidSchema });
export const WorkflowIdParamsSchema = z.object({ orgId: UuidSchema, workflowId: UuidSchema });
export const RunIdParamsSchema = z.object({ orgId: UuidSchema, runId: UuidSchema });
export const ApprovalIdParamsSchema = z.object({ orgId: UuidSchema, approvalId: UuidSchema });
export const TemplateKeyParamsSchema = z.object({
    orgId: UuidSchema,
    templateKey: z.string().min(1).max(120),
});
export const PaginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    sortBy: z.string().max(50).optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
/** Valid IANA timezone check (basic: alphanumeric + slashes + underscores, max length) */
const TimezoneSchema = z
    .string()
    .max(LIMITS.MAX_TIMEZONE_LENGTH)
    .regex(/^[A-Za-z_][A-Za-z0-9_+\-/]*$/, 'Invalid timezone format')
    .default('UTC');
/**
 * 5-field cron expression: minute hour dom month dow
 * Allows standard cron characters: digits, *, /, -, comma, and named months/days.
 * Rejects expressions that are too long or contain dangerous characters.
 */
const CronSchema = z
    .string()
    .min(5)
    .max(LIMITS.MAX_CRON_LENGTH)
    .regex(/^[\d*,/\-?LW#a-zA-Z ]{5,120}$/, 'Invalid cron expression. Must be a valid 5-field cron.')
    .refine((val) => {
    const parts = val.trim().split(/\s+/);
    return parts.length === 5;
}, { message: 'Cron must have exactly 5 fields (minute hour dom month dow)' });
/** JSON object (not array, not null) */
const JsonObjectSchema = z.record(z.string(), z.unknown()).default({});
/** Bounded metadata */
const MetadataSchema = z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= LIMITS.MAX_METADATA_SIZE_BYTES, {
    message: `Metadata must not exceed ${LIMITS.MAX_METADATA_SIZE_BYTES} bytes`,
})
    .default({});
/** Tags array with limits */
const TagsSchema = z
    .array(z.string().min(1).max(LIMITS.MAX_TAG_LENGTH))
    .max(LIMITS.MAX_TAGS)
    .default([]);
// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER DEFINITION SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const TriggerDefinitionSchema = z
    .object({
    triggerKind: z.enum(TRIGGER_KINDS),
    triggerType: z.enum(TRIGGER_TYPES),
    sourceModule: z.string().min(1).max(80),
    sourceEvent: z.string().max(120).optional(),
    scheduleCron: CronSchema.optional(),
    timezone: TimezoneSchema,
    webhookSecretHash: z.string().max(255).optional(),
    isEnabled: z.boolean().default(true),
    dedupeKeyTemplate: z.string().max(500).optional(),
    cooldownSeconds: z.number().int().min(LIMITS.MIN_COOLDOWN_SECONDS).max(LIMITS.MAX_COOLDOWN_SECONDS).default(0),
    config: JsonObjectSchema,
    metadata: MetadataSchema,
})
    .refine((data) => {
    if (data.triggerKind === 'schedule' && !data.scheduleCron)
        return false;
    return true;
}, { message: 'Schedule triggers require scheduleCron' })
    .refine((data) => {
    if (data.triggerKind === 'event' && !data.sourceEvent)
        return false;
    return true;
}, { message: 'Event triggers require sourceEvent' });
// ═══════════════════════════════════════════════════════════════════════════════
// CONDITION DEFINITION SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const ConditionDefinitionSchema = z.object({
    conditionGroup: z.string().min(1).max(80).default('default'),
    sortOrder: z.number().int().min(0).default(0),
    leftPath: z.string().min(1).max(LIMITS.MAX_LEFT_PATH_LENGTH),
    operator: z.enum(CONDITION_OPERATORS),
    rightValue: z.unknown().optional(),
    valueType: z.string().max(30).default('json'),
    isRequired: z.boolean().default(true),
    metadata: MetadataSchema,
});
// ═══════════════════════════════════════════════════════════════════════════════
// ACTION DEFINITION SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const ActionDefinitionSchema = z
    .object({
    actionKey: z.string().min(1).max(LIMITS.MAX_ACTION_KEY_LENGTH),
    actionType: z.enum(ACTION_TYPES),
    integrationKey: z.string().max(80).optional(),
    sortOrder: z.number().int().min(0).default(0),
    isEnabled: z.boolean().default(true),
    requiresApproval: z.boolean().default(false),
    riskLevel: z.enum(ACTION_RISK_LEVELS).default('low'),
    timeoutSeconds: z
        .number()
        .int()
        .min(LIMITS.MIN_TIMEOUT_SECONDS)
        .max(LIMITS.MAX_TIMEOUT_SECONDS)
        .default(60),
    maxAttempts: z.number().int().min(LIMITS.MIN_MAX_ATTEMPTS).max(LIMITS.MAX_MAX_ATTEMPTS).default(3),
    retryBackoffSeconds: z.number().int().min(0).max(LIMITS.MAX_RETRY_BACKOFF_SECONDS).default(30),
    idempotencyKeyTemplate: z.string().max(500).optional(),
    config: JsonObjectSchema,
    metadata: MetadataSchema,
})
    .refine((data) => {
    // High/critical risk actions must require approval
    if ((data.riskLevel === 'high' || data.riskLevel === 'critical') && !data.requiresApproval) {
        return false;
    }
    return true;
}, { message: 'High or critical risk actions must require approval' });
// ═══════════════════════════════════════════════════════════════════════════════
// SAFETY DEFINITION SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const SafetyDefinitionSchema = z.object({
    maxRunsPerHour: z.number().int().min(1).max(10000).default(100),
    dedupeWindowSeconds: z.number().int().min(0).max(86400).default(300),
    requiresApprovalAboveRisk: z.enum(ACTION_RISK_LEVELS).default('high'),
});
// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK SAFETY METADATA
// ═══════════════════════════════════════════════════════════════════════════════
export const WebhookSafetyMetadataSchema = z.object({
    /** Whether the target URL is on the org's allowlist */
    isAllowlisted: z.boolean().default(false),
    /** The external URL being called */
    targetUrl: z.string().url().max(2000).optional(),
    /** Headers that will be sent (no secrets) */
    safeHeaders: z.record(z.string(), z.string()).default({}),
    /** Whether TLS is required */
    requireTls: z.boolean().default(true),
});
// ═══════════════════════════════════════════════════════════════════════════════
// CREATE WORKFLOW SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const CreateWorkflowSchema = z.object({
    name: z.string().min(1).max(LIMITS.MAX_WORKFLOW_NAME_LENGTH),
    description: z.string().max(LIMITS.MAX_DESCRIPTION_LENGTH).optional(),
    workflowType: z.enum(WORKFLOW_TYPES),
    scope: z.enum(WORKFLOW_SCOPES).default('organization'),
    projectId: UuidSchema.optional(),
    trigger: TriggerDefinitionSchema,
    conditions: z.array(ConditionDefinitionSchema).max(LIMITS.MAX_CONDITIONS).default([]),
    actions: z.array(ActionDefinitionSchema).min(1).max(LIMITS.MAX_ACTIONS),
    safety: SafetyDefinitionSchema.optional(),
    tags: TagsSchema,
    metadata: MetadataSchema,
    timezone: TimezoneSchema,
});
// ═══════════════════════════════════════════════════════════════════════════════
// UPDATE WORKFLOW SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const UpdateWorkflowSchema = z.object({
    name: z.string().min(1).max(LIMITS.MAX_WORKFLOW_NAME_LENGTH).optional(),
    description: z.string().max(LIMITS.MAX_DESCRIPTION_LENGTH).optional(),
    trigger: TriggerDefinitionSchema.optional(),
    conditions: z.array(ConditionDefinitionSchema).max(LIMITS.MAX_CONDITIONS).optional(),
    actions: z.array(ActionDefinitionSchema).min(1).max(LIMITS.MAX_ACTIONS).optional(),
    safety: SafetyDefinitionSchema.optional(),
    tags: TagsSchema.optional(),
    metadata: MetadataSchema.optional(),
    timezone: TimezoneSchema.optional(),
});
// ═══════════════════════════════════════════════════════════════════════════════
// PUBLISH WORKFLOW SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const PublishWorkflowSchema = z.object({
    activateOnPublish: z.boolean().default(false),
});
// ═══════════════════════════════════════════════════════════════════════════════
// MANUAL RUN SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const ManualRunSchema = z.object({
    inputPayload: z
        .record(z.string(), z.unknown())
        .refine((v) => JSON.stringify(v).length <= LIMITS.MAX_PAYLOAD_SIZE_BYTES, {
        message: `Payload must not exceed ${LIMITS.MAX_PAYLOAD_SIZE_BYTES} bytes`,
    })
        .default({}),
    metadata: MetadataSchema,
});
// ═══════════════════════════════════════════════════════════════════════════════
// TEST WORKFLOW SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const TestWorkflowSchema = z.object({
    simulatedPayload: z
        .record(z.string(), z.unknown())
        .refine((v) => JSON.stringify(v).length <= LIMITS.MAX_PAYLOAD_SIZE_BYTES, {
        message: `Payload must not exceed ${LIMITS.MAX_PAYLOAD_SIZE_BYTES} bytes`,
    })
        .default({}),
    dryRun: z.boolean().default(true),
});
// ═══════════════════════════════════════════════════════════════════════════════
// LIST WORKFLOWS QUERY SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const ListWorkflowsQuerySchema = PaginationSchema.extend({
    status: z.enum(WORKFLOW_STATUSES).optional(),
    workflowType: z.enum(WORKFLOW_TYPES).optional(),
    isEnabled: z.coerce.boolean().optional(),
    projectId: UuidSchema.optional(),
    search: z.string().max(200).optional(),
    tags: z.string().max(1000).optional(), // comma-separated
});
// ═══════════════════════════════════════════════════════════════════════════════
// LIST RUNS QUERY SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const ListRunsQuerySchema = PaginationSchema.extend({
    status: z.enum(RUN_STATUSES).optional(),
    workflowId: UuidSchema.optional(),
    triggerType: z.enum(TRIGGER_TYPES).optional(),
});
// ═══════════════════════════════════════════════════════════════════════════════
// CANCEL RUN SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const CancelRunSchema = z.object({
    reason: z.string().max(500).optional(),
});
// ═══════════════════════════════════════════════════════════════════════════════
// RETRY RUN SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const RetryRunSchema = z.object({
    fromStep: UuidSchema.optional(),
});
// ═══════════════════════════════════════════════════════════════════════════════
// APPROVE APPROVAL SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const ApproveApprovalSchema = z.object({
    reason: z.string().max(1000).optional(),
    decisionPayload: JsonObjectSchema,
});
// ═══════════════════════════════════════════════════════════════════════════════
// REJECT APPROVAL SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const RejectApprovalSchema = z.object({
    reason: z.string().min(1).max(1000),
    decisionPayload: JsonObjectSchema,
});
// ═══════════════════════════════════════════════════════════════════════════════
// CREATE FROM TEMPLATE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const CreateFromTemplateSchema = z.object({
    name: z.string().min(1).max(LIMITS.MAX_WORKFLOW_NAME_LENGTH),
    description: z.string().max(LIMITS.MAX_DESCRIPTION_LENGTH).optional(),
    projectId: UuidSchema.optional(),
    /** Override template defaults */
    configOverrides: JsonObjectSchema,
    tags: TagsSchema,
    metadata: MetadataSchema,
});
// ═══════════════════════════════════════════════════════════════════════════════
// INGEST AUTOMATION EVENT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const IngestEventSchema = z.object({
    sourceModule: z.string().min(1).max(80),
    eventType: z.enum(TRIGGER_TYPES),
    sourceEventId: z.string().max(200).optional(),
    dedupeKey: z.string().min(1).max(LIMITS.MAX_DEDUPE_KEY_LENGTH),
    payload: z
        .record(z.string(), z.unknown())
        .refine((v) => JSON.stringify(v).length <= LIMITS.MAX_PAYLOAD_SIZE_BYTES, {
        message: `Payload must not exceed ${LIMITS.MAX_PAYLOAD_SIZE_BYTES} bytes`,
    })
        .default({}),
    headers: z.record(z.string(), z.string()).default({}),
    metadata: MetadataSchema,
    projectId: UuidSchema.optional(),
});
// ═══════════════════════════════════════════════════════════════════════════════
// LIST AUDIT QUERY SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const ListAuditQuerySchema = PaginationSchema.extend({
    workflowId: UuidSchema.optional(),
    runId: UuidSchema.optional(),
    action: z.string().max(120).optional(),
    actorUserId: UuidSchema.optional(),
});
// ═══════════════════════════════════════════════════════════════════════════════
// LIST APPROVALS QUERY SCHEMA
// ═══════════════════════════════════════════════════════════════════════════════
export const ListApprovalsQuerySchema = PaginationSchema.extend({
    status: z.enum(APPROVAL_STATUSES).optional(),
    workflowId: UuidSchema.optional(),
    riskLevel: z.enum(ACTION_RISK_LEVELS).optional(),
});
// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE DEFINITION JSON SHAPE SCHEMA (for validation)
// ═══════════════════════════════════════════════════════════════════════════════
export const TemplateDefinitionSchema = z.object({
    schemaVersion: z.number().int().min(1).max(100),
    workflowType: z.enum(WORKFLOW_TYPES),
    trigger: z.object({
        kind: z.enum(TRIGGER_KINDS),
        type: z.enum(TRIGGER_TYPES),
        sourceModule: z.string().min(1).max(80),
    }),
    conditions: z.array(z.object({
        leftPath: z.string().min(1).max(LIMITS.MAX_LEFT_PATH_LENGTH),
        operator: z.enum(CONDITION_OPERATORS),
        rightValue: z.unknown().optional(),
    })).max(LIMITS.MAX_CONDITIONS).default([]),
    actions: z.array(z.object({
        actionKey: z.string().min(1).max(LIMITS.MAX_ACTION_KEY_LENGTH),
        actionType: z.enum(ACTION_TYPES),
        riskLevel: z.enum(ACTION_RISK_LEVELS).default('low'),
        requiresApproval: z.boolean().default(false),
        config: JsonObjectSchema,
    })).min(1).max(LIMITS.MAX_ACTIONS),
    safety: SafetyDefinitionSchema.optional(),
});
//# sourceMappingURL=schemas.js.map