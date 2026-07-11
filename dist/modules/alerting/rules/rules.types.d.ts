import { z } from 'zod';
import type { AlertSeverity } from '../common.js';
export { AlertSeveritySchema } from '../common.js';
export type { AlertSeverity } from '../common.js';
export declare const ConditionTypeSchema: z.ZodEnum<{
    threshold: "threshold";
    change: "change";
    anomaly: "anomaly";
    static: "static";
    composite: "composite";
}>;
export type ConditionType = z.infer<typeof ConditionTypeSchema>;
export declare const ConditionOperatorSchema: z.ZodEnum<{
    in: "in";
    gt: "gt";
    lt: "lt";
    gte: "gte";
    lte: "lte";
    eq: "eq";
    neq: "neq";
    contains: "contains";
    regex: "regex";
    exists: "exists";
}>;
export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;
export declare const ActionTypeSchema: z.ZodEnum<{
    group: "group";
    notify: "notify";
    webhook: "webhook";
    suppress: "suppress";
    escalate: "escalate";
}>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export declare const AGGREGATE_FUNCTIONS: readonly ["avg", "sum", "count", "max", "min", "p99"];
export declare const RuleConditionSchema: z.ZodObject<{
    conditionType: z.ZodDefault<z.ZodEnum<{
        threshold: "threshold";
        change: "change";
        anomaly: "anomaly";
        static: "static";
        composite: "composite";
    }>>;
    conditionGroupId: z.ZodOptional<z.ZodString>;
    fieldPath: z.ZodString;
    operator: z.ZodEnum<{
        in: "in";
        gt: "gt";
        lt: "lt";
        gte: "gte";
        lte: "lte";
        eq: "eq";
        neq: "neq";
        contains: "contains";
        regex: "regex";
        exists: "exists";
    }>;
    thresholdValue: z.ZodOptional<z.ZodUnknown>;
    lookbackMinutes: z.ZodOptional<z.ZodNumber>;
    aggregateFunction: z.ZodOptional<z.ZodEnum<{
        max: "max";
        min: "min";
        count: "count";
        avg: "avg";
        sum: "sum";
        p99: "p99";
    }>>;
    isRequired: z.ZodDefault<z.ZodBoolean>;
    orderIndex: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type RuleConditionInput = z.infer<typeof RuleConditionSchema>;
export declare const RuleActionSchema: z.ZodObject<{
    actionType: z.ZodDefault<z.ZodEnum<{
        group: "group";
        notify: "notify";
        webhook: "webhook";
        suppress: "suppress";
        escalate: "escalate";
    }>>;
    priority: z.ZodDefault<z.ZodNumber>;
    orderIndex: z.ZodDefault<z.ZodNumber>;
    connectorId: z.ZodOptional<z.ZodString>;
    routeId: z.ZodOptional<z.ZodString>;
    templateId: z.ZodOptional<z.ZodString>;
    escalationPolicyId: z.ZodOptional<z.ZodString>;
    throttleDurationSeconds: z.ZodDefault<z.ZodNumber>;
    maxNotificationsPerHour: z.ZodOptional<z.ZodNumber>;
    actionConditions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type RuleActionInput = z.infer<typeof RuleActionSchema>;
export declare const CreateRuleSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    severity: z.ZodDefault<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    evaluationIntervalSeconds: z.ZodDefault<z.ZodNumber>;
    cooldownSeconds: z.ZodDefault<z.ZodNumber>;
    autoResolveAfterMinutes: z.ZodOptional<z.ZodNumber>;
    deduplicationWindowSeconds: z.ZodDefault<z.ZodNumber>;
    deduplicationKeyTemplate: z.ZodOptional<z.ZodString>;
    groupingEnabled: z.ZodDefault<z.ZodBoolean>;
    groupingKeyTemplate: z.ZodOptional<z.ZodString>;
    groupingWaitSeconds: z.ZodDefault<z.ZodNumber>;
    labels: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    annotations: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    metadata: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    conditions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        conditionType: z.ZodDefault<z.ZodEnum<{
            threshold: "threshold";
            change: "change";
            anomaly: "anomaly";
            static: "static";
            composite: "composite";
        }>>;
        conditionGroupId: z.ZodOptional<z.ZodString>;
        fieldPath: z.ZodString;
        operator: z.ZodEnum<{
            in: "in";
            gt: "gt";
            lt: "lt";
            gte: "gte";
            lte: "lte";
            eq: "eq";
            neq: "neq";
            contains: "contains";
            regex: "regex";
            exists: "exists";
        }>;
        thresholdValue: z.ZodOptional<z.ZodUnknown>;
        lookbackMinutes: z.ZodOptional<z.ZodNumber>;
        aggregateFunction: z.ZodOptional<z.ZodEnum<{
            max: "max";
            min: "min";
            count: "count";
            avg: "avg";
            sum: "sum";
            p99: "p99";
        }>>;
        isRequired: z.ZodDefault<z.ZodBoolean>;
        orderIndex: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>>;
    actions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        actionType: z.ZodDefault<z.ZodEnum<{
            group: "group";
            notify: "notify";
            webhook: "webhook";
            suppress: "suppress";
            escalate: "escalate";
        }>>;
        priority: z.ZodDefault<z.ZodNumber>;
        orderIndex: z.ZodDefault<z.ZodNumber>;
        connectorId: z.ZodOptional<z.ZodString>;
        routeId: z.ZodOptional<z.ZodString>;
        templateId: z.ZodOptional<z.ZodString>;
        escalationPolicyId: z.ZodOptional<z.ZodString>;
        throttleDurationSeconds: z.ZodDefault<z.ZodNumber>;
        maxNotificationsPerHour: z.ZodOptional<z.ZodNumber>;
        actionConditions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        isActive: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type CreateRuleBody = z.infer<typeof CreateRuleSchema>;
export declare const UpdateRuleSchema: z.ZodObject<{
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    name: z.ZodOptional<z.ZodString>;
    enabled: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    metadata: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    severity: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>>;
    evaluationIntervalSeconds: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    cooldownSeconds: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    autoResolveAfterMinutes: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    deduplicationWindowSeconds: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    deduplicationKeyTemplate: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    groupingEnabled: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    groupingKeyTemplate: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    groupingWaitSeconds: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    labels: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    annotations: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    conditions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        conditionType: z.ZodDefault<z.ZodEnum<{
            threshold: "threshold";
            change: "change";
            anomaly: "anomaly";
            static: "static";
            composite: "composite";
        }>>;
        conditionGroupId: z.ZodOptional<z.ZodString>;
        fieldPath: z.ZodString;
        operator: z.ZodEnum<{
            in: "in";
            gt: "gt";
            lt: "lt";
            gte: "gte";
            lte: "lte";
            eq: "eq";
            neq: "neq";
            contains: "contains";
            regex: "regex";
            exists: "exists";
        }>;
        thresholdValue: z.ZodOptional<z.ZodUnknown>;
        lookbackMinutes: z.ZodOptional<z.ZodNumber>;
        aggregateFunction: z.ZodOptional<z.ZodEnum<{
            max: "max";
            min: "min";
            count: "count";
            avg: "avg";
            sum: "sum";
            p99: "p99";
        }>>;
        isRequired: z.ZodDefault<z.ZodBoolean>;
        orderIndex: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>>;
    actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        actionType: z.ZodDefault<z.ZodEnum<{
            group: "group";
            notify: "notify";
            webhook: "webhook";
            suppress: "suppress";
            escalate: "escalate";
        }>>;
        priority: z.ZodDefault<z.ZodNumber>;
        orderIndex: z.ZodDefault<z.ZodNumber>;
        connectorId: z.ZodOptional<z.ZodString>;
        routeId: z.ZodOptional<z.ZodString>;
        templateId: z.ZodOptional<z.ZodString>;
        escalationPolicyId: z.ZodOptional<z.ZodString>;
        throttleDurationSeconds: z.ZodDefault<z.ZodNumber>;
        maxNotificationsPerHour: z.ZodOptional<z.ZodNumber>;
        actionConditions: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        isActive: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type UpdateRuleBody = z.infer<typeof UpdateRuleSchema>;
export declare const ListRulesQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    enabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    severity: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    search: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ListRulesQuery = z.infer<typeof ListRulesQuerySchema>;
export declare const TestRuleSchema: z.ZodObject<{
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
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
export declare const OrgRuleParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    id: z.ZodString;
}, z.core.$strip>;
//# sourceMappingURL=rules.types.d.ts.map