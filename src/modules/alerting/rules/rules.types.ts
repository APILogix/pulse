import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema } from '../common.js';
import type { AlertSeverity } from '../common.js';
import type { RequestMeta } from '../types.js';


import { AppError } from '../../../shared/errors/app-error.js';

export { AlertSeveritySchema } from '../common.js';
export type { AlertSeverity } from '../common.js';

export const ConditionTypeSchema = z.enum(['threshold', 'change', 'anomaly', 'static', 'composite']);

export type ConditionType = z.infer<typeof ConditionTypeSchema>;

export const ConditionOperatorSchema = z.enum([
  'gt', 'lt', 'gte', 'lte', 'eq', 'neq', 'contains', 'regex', 'in', 'exists',
]);

export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

export const ActionTypeSchema = z.enum(['notify', 'webhook', 'suppress', 'escalate', 'group']);

export type ActionType = z.infer<typeof ActionTypeSchema>;

export const AGGREGATE_FUNCTIONS = ['avg', 'sum', 'count', 'max', 'min', 'p99'] as const;

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
  projectId: UuidSchema.optional(),
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
  /** Optional project scope (NULL = org-level rule). */
  project_id: string | null;
  /** Platform preset identifier for seeded default rules. */
  preset_key: string | null;
  /** TRUE for platform-managed default (preset) rules. */
  is_default: boolean;
  /** Evaluator watermark — last time the scheduled evaluator ran this rule. */
  last_evaluated_at: Date | null;
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

export const OrgRuleParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema });

