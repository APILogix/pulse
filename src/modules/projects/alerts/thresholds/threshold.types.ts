import { z } from "zod";
import { normalizeObjectKeys } from "../../shared/schema-utils.js";

const UuidSchema = z.string().uuid();

const BooleanInputSchema = z.preprocess((value) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
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
} as const;

/** Applies shared aliases first, then aliases owned by the threshold module. */
export function normalizeThresholdObjectKeys(value: unknown): unknown {
  const normalized = normalizeObjectKeys(value);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return normalized;

  const record = normalized as Record<string, unknown>;
  for (const [camel, snake] of Object.entries(THRESHOLD_ALIASES)) {
    if (record[camel] === undefined && record[snake] !== undefined) record[camel] = record[snake];
  }
  return record;
}

export const ThresholdComparisonOperatorSchema = z.enum([">", ">=", "<", "<=", "=", "!="]);
export type ThresholdComparisonOperator = z.infer<typeof ThresholdComparisonOperatorSchema>;

export const ProjectThresholdParamsSchema = z.preprocess(
  normalizeThresholdObjectKeys,
  z.object({ orgId: UuidSchema, projectId: UuidSchema }),
);

export const ThresholdDetailParamsSchema = z.preprocess(
  normalizeThresholdObjectKeys,
  z.object({ orgId: UuidSchema, projectId: UuidSchema, thresholdId: UuidSchema }),
);

export const ListThresholdsQuerySchema = z.preprocess(
  normalizeThresholdObjectKeys,
  z.object({
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
  }),
);
export type ListThresholdsQuery = z.infer<typeof ListThresholdsQuerySchema>;

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
} as const;

export const CreateThresholdBodySchema = z.preprocess(
  normalizeThresholdObjectKeys,
  z.object({
    ...ThresholdMutationFields,
    evaluationWindowMinutes: ThresholdMutationFields.evaluationWindowMinutes.default(5),
    cooldownMinutes: ThresholdMutationFields.cooldownMinutes.default(15),
    consecutiveBreaches: ThresholdMutationFields.consecutiveBreaches.default(1),
    enabled: ThresholdMutationFields.enabled.default(true),
    notifyOnRecovery: ThresholdMutationFields.notifyOnRecovery.default(true),
  }),
);
export type CreateThresholdBody = z.infer<typeof CreateThresholdBodySchema>;

export const UpdateThresholdBodySchema = z.preprocess(
  normalizeThresholdObjectKeys,
  z.object({
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
  }).refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" }),
);
export type UpdateThresholdBody = z.infer<typeof UpdateThresholdBodySchema>;

export const ToggleThresholdBodySchema = z.preprocess(
  normalizeThresholdObjectKeys,
  z.object({ enabled: BooleanInputSchema }),
);
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