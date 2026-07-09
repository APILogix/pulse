/**
 * Alerting module â€” types, Zod schemas, DB row types, DTOs, and errors.
 *
 * Conventions (matching connectors/organization modules):
 *   - Zod schemas drive request validation and enum parity with Postgres.
 *   - DB rows are snake_case; response DTOs are camelCase.
 *   - Module errors extend the shared AppError for uniform HTTP mapping.
 *   - Enums match migrations2/003_alerting_create_core_schema.up.sql exactly.
 */
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
export declare const AlertSeveritySchema: z.ZodEnum<{
    error: "error";
    info: "info";
    warning: "warning";
    critical: "critical";
}>;
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;
export declare const AlertEventStatusSchema: z.ZodEnum<{
    error: "error";
    pending: "pending";
    processing: "processing";
    firing: "firing";
    resolved: "resolved";
    acknowledged: "acknowledged";
    suppressed: "suppressed";
    silenced: "silenced";
}>;
export type AlertEventStatus = z.infer<typeof AlertEventStatusSchema>;
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
    webhook: "webhook";
    notify: "notify";
    suppress: "suppress";
    escalate: "escalate";
}>;
export type ActionType = z.infer<typeof ActionTypeSchema>;
export declare const DeliveryAttemptStatusSchema: z.ZodEnum<{
    pending: "pending";
    cancelled: "cancelled";
    failed: "failed";
    queued: "queued";
    sent: "sent";
    delivered: "delivered";
    retrying: "retrying";
}>;
export type DeliveryAttemptStatus = z.infer<typeof DeliveryAttemptStatusSchema>;
export declare const BatchStatusSchema: z.ZodEnum<{
    pending: "pending";
    failed: "failed";
    processing: "processing";
    completed: "completed";
    partial: "partial";
}>;
export type BatchStatus = z.infer<typeof BatchStatusSchema>;
export declare const HistoryActionSchema: z.ZodEnum<{
    resolved: "resolved";
    acknowledged: "acknowledged";
    suppressed: "suppressed";
    silenced: "silenced";
    triggered: "triggered";
    escalated: "escalated";
    notified: "notified";
    grouped: "grouped";
    auto_resolved: "auto_resolved";
    rule_modified: "rule_modified";
}>;
export type HistoryAction = z.infer<typeof HistoryActionSchema>;
export declare const MetricGranularitySchema: z.ZodEnum<{
    week: "week";
    day: "day";
    hour: "hour";
    month: "month";
}>;
export type MetricGranularity = z.infer<typeof MetricGranularitySchema>;
export declare const AGGREGATE_FUNCTIONS: readonly ["avg", "sum", "count", "max", "min", "p99"];
export declare const UuidSchema: z.ZodString;
export declare const OrgIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const OrgRuleParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    id: z.ZodString;
}, z.core.$strip>;
export declare const OrgEventParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    id: z.ZodString;
}, z.core.$strip>;
export declare const OrgPolicyParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    id: z.ZodString;
}, z.core.$strip>;
export declare const OrgPolicyStepParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    id: z.ZodString;
    stepId: z.ZodString;
}, z.core.$strip>;
export declare const PaginationSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>;
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
        avg: "avg";
        sum: "sum";
        count: "count";
        p99: "p99";
    }>>;
    isRequired: z.ZodDefault<z.ZodBoolean>;
    orderIndex: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type RuleConditionInput = z.infer<typeof RuleConditionSchema>;
export declare const RuleActionSchema: z.ZodObject<{
    actionType: z.ZodDefault<z.ZodEnum<{
        group: "group";
        webhook: "webhook";
        notify: "notify";
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
            avg: "avg";
            sum: "sum";
            count: "count";
            p99: "p99";
        }>>;
        isRequired: z.ZodDefault<z.ZodBoolean>;
        orderIndex: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>>;
    actions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        actionType: z.ZodDefault<z.ZodEnum<{
            group: "group";
            webhook: "webhook";
            notify: "notify";
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
            avg: "avg";
            sum: "sum";
            count: "count";
            p99: "p99";
        }>>;
        isRequired: z.ZodDefault<z.ZodBoolean>;
        orderIndex: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>>;
    actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        actionType: z.ZodDefault<z.ZodEnum<{
            group: "group";
            webhook: "webhook";
            notify: "notify";
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
export declare const IngestEventSchema: z.ZodObject<{
    ruleId: z.ZodOptional<z.ZodString>;
    severity: z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>;
    source: z.ZodString;
    sourceId: z.ZodOptional<z.ZodString>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    labels: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    annotations: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    fingerprint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type IngestEventBody = z.infer<typeof IngestEventSchema>;
export declare const ListEventsQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        error: "error";
        pending: "pending";
        processing: "processing";
        firing: "firing";
        resolved: "resolved";
        acknowledged: "acknowledged";
        suppressed: "suppressed";
        silenced: "silenced";
    }>>;
    severity: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    source: z.ZodOptional<z.ZodString>;
    ruleId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;
export declare const AcknowledgeEventSchema: z.ZodObject<{
    comment: z.ZodOptional<z.ZodString>;
    expiresInMinutes: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type AcknowledgeEventBody = z.infer<typeof AcknowledgeEventSchema>;
export declare const ResolveEventSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
    comment: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ResolveEventBody = z.infer<typeof ResolveEventSchema>;
export declare const CreateSilenceSchema: z.ZodObject<{
    ruleId: z.ZodOptional<z.ZodString>;
    comment: z.ZodOptional<z.ZodString>;
    startsAt: z.ZodCoercedDate<unknown>;
    endsAt: z.ZodCoercedDate<unknown>;
    matchers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type CreateSilenceBody = z.infer<typeof CreateSilenceSchema>;
export declare const SilenceFromEventSchema: z.ZodObject<{
    durationMinutes: z.ZodDefault<z.ZodNumber>;
    comment: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SilenceFromEventBody = z.infer<typeof SilenceFromEventSchema>;
export declare const ListSilencesQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    active: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
}, z.core.$strip>;
export type ListSilencesQuery = z.infer<typeof ListSilencesQuerySchema>;
export declare const CreateEscalationPolicySchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    repeatIntervalMinutes: z.ZodOptional<z.ZodNumber>;
    maxRepeats: z.ZodDefault<z.ZodNumber>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type CreateEscalationPolicyBody = z.infer<typeof CreateEscalationPolicySchema>;
export declare const UpsertEscalationStepSchema: z.ZodObject<{
    stepNumber: z.ZodNumber;
    waitMinutes: z.ZodDefault<z.ZodNumber>;
    connectorIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    routeIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    notifyOnCall: z.ZodDefault<z.ZodBoolean>;
    customMessageTemplate: z.ZodOptional<z.ZodString>;
    templateId: z.ZodOptional<z.ZodString>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type UpsertEscalationStepBody = z.infer<typeof UpsertEscalationStepSchema>;
export declare const CreateTemplateSchema: z.ZodObject<{
    name: z.ZodString;
    templateType: z.ZodDefault<z.ZodString>;
    content: z.ZodString;
    variablesSchema: z.ZodDefault<z.ZodArray<z.ZodUnknown>>;
    defaultForSeverity: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    connectorType: z.ZodOptional<z.ZodString>;
    isDefault: z.ZodDefault<z.ZodBoolean>;
    sampleData: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type CreateTemplateBody = z.infer<typeof CreateTemplateSchema>;
export declare const UpdateTemplateSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    templateType: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    content: z.ZodOptional<z.ZodString>;
    variablesSchema: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodUnknown>>>;
    defaultForSeverity: z.ZodOptional<z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>>;
    connectorType: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    isDefault: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    sampleData: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$strip>;
export type UpdateTemplateBody = z.infer<typeof UpdateTemplateSchema>;
export declare const PreviewTemplateSchema: z.ZodObject<{
    sampleData: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type PreviewTemplateBody = z.infer<typeof PreviewTemplateSchema>;
export declare const RoutingConditionsSchema: z.ZodObject<{
    severity: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>>;
    source: z.ZodOptional<z.ZodArray<z.ZodString>>;
    labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export type RoutingConditions = z.infer<typeof RoutingConditionsSchema>;
export declare const CreateRoutingRuleSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    priority: z.ZodDefault<z.ZodNumber>;
    conditions: z.ZodDefault<z.ZodObject<{
        severity: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            error: "error";
            info: "info";
            warning: "warning";
            critical: "critical";
        }>>>;
        source: z.ZodOptional<z.ZodArray<z.ZodString>>;
        labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>;
    targetConnectorIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    targetRouteIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    fallbackConnectorIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    templateId: z.ZodOptional<z.ZodString>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type CreateRoutingRuleBody = z.infer<typeof CreateRoutingRuleSchema>;
export declare const UpdateRoutingRuleSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    priority: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    conditions: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        severity: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            error: "error";
            info: "info";
            warning: "warning";
            critical: "critical";
        }>>>;
        source: z.ZodOptional<z.ZodArray<z.ZodString>>;
        labels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>>>;
    targetConnectorIds: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    targetRouteIds: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    fallbackConnectorIds: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    templateId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    isActive: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
}, z.core.$strip>;
export type UpdateRoutingRuleBody = z.infer<typeof UpdateRoutingRuleSchema>;
export declare const TestRoutingSchema: z.ZodObject<{
    severity: z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>;
    source: z.ZodString;
    labels: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export type TestRoutingBody = z.infer<typeof TestRoutingSchema>;
export declare const MetricsQuerySchema: z.ZodObject<{
    metricType: z.ZodOptional<z.ZodString>;
    ruleId: z.ZodOptional<z.ZodString>;
    granularity: z.ZodDefault<z.ZodEnum<{
        week: "week";
        day: "day";
        hour: "hour";
        month: "month";
    }>>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;
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
    value: string;
    bucket_start: Date;
    bucket_end: Date;
    granularity: MetricGranularity;
    labels: Record<string, unknown>;
    created_at: Date;
}
export interface RequestMeta {
    actorUserId: string;
    actorIp: string;
    actorUserAgent: string | null;
    requestId: string;
}
export declare class AlertError extends AppError {
    constructor(message: string, code?: string, statusCode?: number, details?: Record<string, unknown>);
}
export declare class AlertNotFoundError extends AlertError {
    constructor(resource?: string);
}
export declare class AlertConflictError extends AlertError {
    constructor(message: string);
}
export declare class AlertValidationError extends AlertError {
    constructor(message: string, details?: Record<string, unknown>);
}
//# sourceMappingURL=types.d.ts.map