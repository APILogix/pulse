/**
 * Alerting persistence layer.
 *
 * Owns all SQL for the alerting module. Tenant isolation is enforced in the
 * service layer by always passing `organization_id` into queries (this
 * codebase isolates tenants in the application layer — see migration 003).
 *
 * Performance contract for the batch worker:
 *   - `getBatchWithEvents` fetches a batch + its events in ONE query.
 *   - `bulkUpdateEventStatus` / `bulkInsertDeliveryAttempts` use UNNEST-based
 *     set operations — NO per-row (N+1) writes.
 */
import type { PoolClient } from 'pg';
import { pool } from '../../../config/database.js';
import { type AlertRuleActionRow, type AlertRuleConditionRow, type AlertRuleRow, type ListRulesQuery } from '../types.js';
export interface RuleConditionInsert {
    conditionType: string;
    conditionGroupId: string | null;
    fieldPath: string;
    operator: string;
    thresholdValue: unknown;
    lookbackMinutes: number | null;
    aggregateFunction: string | null;
    isRequired: boolean;
    orderIndex: number;
}
export interface RuleActionInsert {
    actionType: string;
    priority: number;
    orderIndex: number;
    connectorId: string | null;
    routeId: string | null;
    templateId: string | null;
    escalationPolicyId: string | null;
    throttleDurationSeconds: number;
    maxNotificationsPerHour: number | null;
    actionConditions: Record<string, unknown>;
    isActive: boolean;
}
export interface CreateRuleInput {
    organizationId: string;
    name: string;
    description: string | null;
    severity: string;
    enabled: boolean;
    /** Optional project scope (null = org-level rule). */
    projectId?: string | null;
    /** Platform preset identifier (seeded default rules only). */
    presetKey?: string | null;
    /** TRUE for platform-managed default (preset) rules. */
    isDefault?: boolean;
    evaluationIntervalSeconds: number;
    cooldownSeconds: number;
    autoResolveAfterMinutes: number | null;
    deduplicationWindowSeconds: number;
    deduplicationKeyTemplate: string | null;
    groupingEnabled: boolean;
    groupingKeyTemplate: string | null;
    groupingWaitSeconds: number;
    labels: Record<string, unknown>;
    annotations: Record<string, unknown>;
    metadata: Record<string, unknown>;
    createdBy: string;
    conditions: RuleConditionInsert[];
    actions: RuleActionInsert[];
    /** Backend evaluation category: 'fast' or 'analytics'. Defaults to 'analytics'. */
    evaluationCategory?: 'fast' | 'analytics';
}
export declare const ALERT_RULE_CONDITIONS_COLUMNS = "id, rule_id, condition_type, condition_group_id, field_path, operator, threshold_value, lookback_minutes, aggregate_function, sub_query, is_required, order_index, created_at, updated_at";
export declare const ALERT_RULE_ACTIONS_COLUMNS = "id, rule_id, action_type, priority, order_index, connector_id, route_id, template_id, escalation_policy_id, throttle_duration_seconds, max_notifications_per_hour, action_conditions, is_active, created_at, updated_at";
export declare class RulesRepository {
    private readonly db;
    private readonly bindingsForRevision;
    /**
     * ADR-0006: pools are injected explicitly. Alert RULE definition is
     * control-plane owned, so this defaults to the primary pool and callers that
     * want the boundary enforced pass it in from AlertConfigRepository.
     */
    constructor(db?: typeof pool);
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    createRule(input: CreateRuleInput): Promise<AlertRuleRow>;
    private insertConditions;
    private insertActions;
    findRuleById(organizationId: string, id: string): Promise<AlertRuleRow | null>;
    findRuleByPresetKey(organizationId: string, presetKey: string): Promise<AlertRuleRow | null>;
    getRuleConditions(ruleId: string): Promise<AlertRuleConditionRow[]>;
    getRuleActions(ruleId: string): Promise<AlertRuleActionRow[]>;
    /** Bulk-load active actions for many rules in ONE query (batch worker — no N+1). */
    getRuleActionsByRuleIds(ruleIds: string[]): Promise<AlertRuleActionRow[]>;
    listRules(organizationId: string, query: ListRulesQuery): Promise<{
        data: AlertRuleRow[];
        total: number;
    }>;
    countProjectRules(organizationId: string, projectId: string): Promise<number>;
    /** Replace a rule's scalar fields and (optionally) its conditions/actions. */
    updateRule(organizationId: string, id: string, fields: Record<string, unknown>, conditions: RuleConditionInsert[] | null, actions: RuleActionInsert[] | null, updatedBy: string): Promise<AlertRuleRow>;
    softDeleteRule(organizationId: string, id: string): Promise<void>;
    setRuleEnabled(organizationId: string, id: string, enabled: boolean): Promise<AlertRuleRow>;
}
//# sourceMappingURL=rules.repository.d.ts.map