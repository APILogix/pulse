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
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertEventStatusSchema = z.enum([
  'pending', 'processing', 'firing', 'resolved', 'acknowledged', 'suppressed', 'silenced', 'error',
]);
export type AlertEventStatus = z.infer<typeof AlertEventStatusSchema>;

export const ConditionTypeSchema = z.enum(['threshold', 'change', 'anomaly', 'static', 'composite']);
export type ConditionType = z.infer<typeof ConditionTypeSchema>;

export const ConditionOperatorSchema = z.enum([
  'gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'contains', 'regex', 'in', 'exists',
]);
export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

export const ActionTypeSchema = z.enum(['notify', 'webhook', 'suppress', 'escalate', 'group']);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const DeliveryAttemptStatusSchema = z.enum([
  'pending', 'queued', 'sent', 'delivered', 'failed', 'retrying', 'cancelled',
]);
export type DeliveryAttemptStatus = z.infer<typeof DeliveryAttemptStatusSchema>;

export const BatchStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'partial']);
export type BatchStatus = z.infer<typeof BatchStatusSchema>;

export const HistoryActionSchema = z.enum([
  'triggered', 'acknowledged', 'resolved', 'escalated', 'suppressed', 'notified',
  'silenced', 'grouped', 'auto_resolved', 'rule_modified',
]);
export type HistoryAction = z.infer<typeof HistoryActionSchema>;

export const MetricGranularitySchema = z.enum(['hour', 'day', 'week', 'month']);
export type MetricGranularity = z.infer<typeof MetricGranularitySchema>;

export const AGGREGATE_FUNCTIONS = ['avg', 'sum', 'count', 'max', 'min', 'p99'] as const;

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
export type RuleConditionInput = z.infer<typeof RuleConditionSchema>;

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
export type RuleActionInput = z.infer<typeof RuleActionSchema>;

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
export type CreateRuleBody = z.infer<typeof CreateRuleSchema>;

export const UpdateRuleSchema = CreateRuleSchema.partial().omit({ conditions: true, actions: true }).extend({
  conditions: z.array(RuleConditionSchema).max(50).optional(),
  actions: z.array(RuleActionSchema).max(50).optional(),
});
export type UpdateRuleBody = z.infer<typeof UpdateRuleSchema>;

export const ListRulesQuerySchema = PaginationSchema.extend({
  enabled: z.coerce.boolean().optional(),
  severity: AlertSeveritySchema.optional(),
  search: z.string().max(255).optional(),
});
export type ListRulesQuery = z.infer<typeof ListRulesQuerySchema>;

export const TestRuleSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
});
export type TestRuleBody = z.infer<typeof TestRuleSchema>;

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
export type IngestEventBody = z.infer<typeof IngestEventSchema>;

export const ListEventsQuerySchema = PaginationSchema.extend({
  status: AlertEventStatusSchema.optional(),
  severity: AlertSeveritySchema.optional(),
  source: z.string().max(100).optional(),
  ruleId: UuidSchema.optional(),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

export const AcknowledgeEventSchema = z.object({
  comment: z.string().max(2000).optional(),
  expiresInMinutes: z.number().int().min(1).max(20_160).optional(),
});
export type AcknowledgeEventBody = z.infer<typeof AcknowledgeEventSchema>;

export const ResolveEventSchema = z.object({
  reason: z.string().max(100).optional(),
  comment: z.string().max(2000).optional(),
});
export type ResolveEventBody = z.infer<typeof ResolveEventSchema>;

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
export type CreateSilenceBody = z.infer<typeof CreateSilenceSchema>;

export const SilenceFromEventSchema = z.object({
  durationMinutes: z.number().int().min(1).max(20_160).default(60),
  comment: z.string().max(2000).optional(),
});
export type SilenceFromEventBody = z.infer<typeof SilenceFromEventSchema>;

export const ListSilencesQuerySchema = PaginationSchema.extend({
  active: z.coerce.boolean().optional(),
});
export type ListSilencesQuery = z.infer<typeof ListSilencesQuerySchema>;

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
export type CreateEscalationPolicyBody = z.infer<typeof CreateEscalationPolicySchema>;

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
export type UpsertEscalationStepBody = z.infer<typeof UpsertEscalationStepSchema>;

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
export type CreateTemplateBody = z.infer<typeof CreateTemplateSchema>;

export const UpdateTemplateSchema = CreateTemplateSchema.partial();
export type UpdateTemplateBody = z.infer<typeof UpdateTemplateSchema>;

export const PreviewTemplateSchema = z.object({
  sampleData: z.record(z.string(), z.unknown()).optional(),
});
export type PreviewTemplateBody = z.infer<typeof PreviewTemplateSchema>;

// ════════════════════════════════════════════════════════════════════════
// ROUTING RULE SCHEMAS
// ════════════════════════════════════════════════════════════════════════

export const RoutingConditionsSchema = z.object({
  severity: z.array(AlertSeveritySchema).optional(),
  source: z.array(z.string().max(100)).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});
export type RoutingConditions = z.infer<typeof RoutingConditionsSchema>;

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
export type CreateRoutingRuleBody = z.infer<typeof CreateRoutingRuleSchema>;

export const UpdateRoutingRuleSchema = CreateRoutingRuleSchema.partial();
export type UpdateRoutingRuleBody = z.infer<typeof UpdateRoutingRuleSchema>;

export const TestRoutingSchema = z.object({
  severity: AlertSeveritySchema,
  source: z.string().max(100),
  labels: z.record(z.string(), z.string()).default({}),
});
export type TestRoutingBody = z.infer<typeof TestRoutingSchema>;

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
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;

// ════════════════════════════════════════════════════════════════════════
// DB ROW TYPES (snake_case)
// ════════════════════════════════════════════════════════════════════════

export interface AlertRuleRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  severity: AlertSeverity;
  enabled: boolean;
  evaluation_interval_seconds: number;
  cooldown_seconds: number;
  auto_resolve_after_minutes: number | null;
  deduplication_window_seconds: number;
  deduplication_key_template: string | null;
  grouping_enabled: boolean;
  grouping_key_template: string | null;
  grouping_wait_seconds: number;
  labels: Record<string, unknown>;
  annotations: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_by: string;
  updated_by: string | null;
  enabled_at: Date | null;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AlertRuleConditionRow {
  id: string;
  rule_id: string;
  condition_type: ConditionType;
  condition_group_id: string | null;
  field_path: string;
  operator: ConditionOperator;
  threshold_value: unknown;
  lookback_minutes: number | null;
  aggregate_function: string | null;
  sub_query: Record<string, unknown>;
  is_required: boolean;
  order_index: number;
  created_at: Date;
  updated_at: Date;
}

export interface AlertRuleActionRow {
  id: string;
  rule_id: string;
  action_type: ActionType;
  priority: number;
  order_index: number;
  connector_id: string | null;
  route_id: string | null;
  template_id: string | null;
  escalation_policy_id: string | null;
  throttle_duration_seconds: number;
  max_notifications_per_hour: number | null;
  action_conditions: Record<string, unknown>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AlertEventRow {
  id: string;
  organization_id: string;
  rule_id: string | null;
  status: AlertEventStatus;
  severity: AlertSeverity;
  fingerprint: string;
  source: string;
  source_id: string | null;
  payload: Record<string, unknown>;
  payload_size_bytes: number | null;
  normalized_payload: Record<string, unknown> | null;
  group_id: string | null;
  group_key: string | null;
  is_group_parent: boolean;
  parent_event_id: string | null;
  duplicate_count: number;
  started_at: Date;
  ended_at: Date | null;
  last_notified_at: Date | null;
  next_escalation_at: Date | null;
  auto_resolve_at: Date | null;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  acknowledgment_expires_at: Date | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  resolution_reason: string | null;
  suppressed_by: string | null;
  suppressed_at: Date | null;
  suppression_reason: string | null;
  labels: Record<string, unknown>;
  annotations: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface AlertSilenceRow {
  id: string;
  organization_id: string;
  rule_id: string | null;
  created_by: string;
  comment: string | null;
  starts_at: Date;
  ends_at: Date;
  matchers: Record<string, unknown>;
  is_active: boolean;
  expired_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AlertBatchRow {
  id: string;
  organization_id: string;
  status: BatchStatus;
  event_ids: string[];
  worker_id: string | null;
  pg_boss_job_id: string | null;
  event_count: number;
  success_count: number;
  failure_count: number;
  skipped_count: number;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: number | null;
  error_message: string | null;
  error_details: Record<string, unknown>;
  retry_count: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface AlertDeliveryAttemptRow {
  id: string;
  organization_id: string;
  event_id: string;
  connector_id: string | null;
  route_id: string | null;
  batch_id: string | null;
  status: DeliveryAttemptStatus;
  request_payload: Record<string, unknown> | null;
  response_payload: string | null;
  response_status_code: number | null;
  error_message: string | null;
  error_category: string | null;
  latency_ms: number | null;
  retry_count: number;
  external_message_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AlertTemplateRow {
  id: string;
  organization_id: string;
  name: string;
  template_type: string;
  content: string;
  variables_schema: unknown[];
  default_for_severity: AlertSeverity | null;
  connector_type: string | null;
  is_default: boolean;
  sample_data: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AlertRoutingRuleRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  priority: number;
  conditions: RoutingConditions;
  target_connector_ids: string[];
  target_route_ids: string[];
  fallback_connector_ids: string[];
  template_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AlertEscalationPolicyRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  repeat_interval_minutes: number | null;
  max_repeats: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AlertEscalationStepRow {
  id: string;
  policy_id: string;
  step_number: number;
  wait_minutes: number;
  connector_ids: string[];
  route_ids: string[];
  notify_on_call: boolean;
  custom_message_template: string | null;
  template_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AlertMetricRow {
  id: string;
  organization_id: string;
  rule_id: string | null;
  metric_type: string;
  value: string; // NUMERIC arrives as string
  bucket_start: Date;
  bucket_end: Date;
  granularity: MetricGranularity;
  labels: Record<string, unknown>;
  created_at: Date;
}

// ════════════════════════════════════════════════════════════════════════
// REQUEST METADATA (audit context)
// ════════════════════════════════════════════════════════════════════════

export interface RequestMeta {
  actorUserId: string;
  actorIp: string;
  actorUserAgent: string | null;
  requestId: string;
}

// ════════════════════════════════════════════════════════════════════════
// ERROR CLASSES
// ════════════════════════════════════════════════════════════════════════

export class AlertError extends AppError {
  constructor(message: string, code = 'ALERT_ERROR', statusCode = 400, details?: Record<string, unknown>) {
    super(message, code, statusCode, details);
  }
}

export class AlertNotFoundError extends AlertError {
  constructor(resource = 'Alert resource') {
    super(`${resource} not found`, 'ALERT_NOT_FOUND', 404);
  }
}

export class AlertConflictError extends AlertError {
  constructor(message: string) {
    super(message, 'ALERT_CONFLICT', 409);
  }
}

export class AlertValidationError extends AlertError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ALERT_VALIDATION_ERROR', 422, details);
  }
}
