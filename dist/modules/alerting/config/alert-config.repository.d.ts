/**
 * AlertConfigRepository — control-plane (primary DB) alerting configuration.
 *
 * Architecture: docs/alerting-redesign/adr/0006-database-ownership.md
 *               docs/alerting-redesign/01-target-architecture.md §3
 *               docs/alerting-redesign/08-implementation-plan.md (Increment 1)
 *
 * ADR-0006 enforcing rule:
 *   "No repository may span both pools. AlertConfigRepository (primary) and
 *    AlertRuntimeRepository (Log DB) are separate classes with separate injected
 *    pools."
 *
 * This class owns ONLY mutable configuration and identity:
 *   alert_rules, alert_rule_conditions, alert_rule_actions, alert_silences,
 *   alert_escalation_policies, alert_escalation_steps, alert_templates,
 *   alert_routing_rules.
 *
 * It composes the existing per-domain repositories rather than duplicating their
 * SQL, so Increment 1 changes no queries and therefore no behaviour. What changes
 * is that the pool is now explicit and single-valued: constructing this class with
 * the Log DB pool is a programming error, and `assertConfigPool` proves at boot
 * that the pool it was given really is the control plane.
 *
 * Runtime/event data is deliberately absent here. Legacy runtime access remains on
 * EventsRepository/MetricsRepository until the L9 view swap; new runtime access goes
 * through modules/alerting/runtime/alert-runtime.repository.ts.
 */
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import { type AlertingPoolTarget } from '../runtime/runtime-pool.js';
import type { CreateRuleInput, RuleConditionInsert, RuleActionInsert } from '../rules/rules.repository.js';
import type { AlertRuleRow, AlertRuleConditionRow, AlertRuleActionRow, AlertSilenceRow, AlertEscalationPolicyRow, AlertEscalationStepRow, AlertTemplateRow, AlertRoutingRuleRow, ListRulesQuery } from '../types.js';
export declare class AlertConfigRepository {
    private readonly db;
    private readonly rules;
    private readonly silences;
    private readonly policies;
    private readonly templates;
    private readonly routing;
    /**
     * @param db The PRIMARY control-plane pool. Defaults to config/database.ts so
     *   existing construction sites keep working unchanged.
     */
    constructor(db?: Pool);
    /** The pool this repository is bound to. Exposed for boot verification only. */
    get connectionPool(): Pool;
    /**
     * Boot assertion: prove this pool really is the control plane by resolving the
     * alert configuration tables. Throws AlertingRuntimePoolError otherwise.
     */
    assertConfigPool(logger: Logger): Promise<AlertingPoolTarget>;
    /** Config-scoped transaction. Never spans the Log DB (ADR-0006). */
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    createRule(input: CreateRuleInput): Promise<AlertRuleRow>;
    findRuleById(organizationId: string, id: string): Promise<AlertRuleRow | null>;
    listRules(organizationId: string, query: ListRulesQuery): Promise<{
        data: AlertRuleRow[];
        total: number;
    }>;
    updateRule(organizationId: string, id: string, fields: Record<string, unknown>, conditions: RuleConditionInsert[] | null, actions: RuleActionInsert[] | null, updatedBy: string): Promise<AlertRuleRow>;
    softDeleteRule(organizationId: string, id: string): Promise<void>;
    setRuleEnabled(organizationId: string, id: string, enabled: boolean): Promise<AlertRuleRow>;
    getRuleConditions(ruleId: string): Promise<AlertRuleConditionRow[]>;
    getRuleActions(ruleId: string): Promise<AlertRuleActionRow[]>;
    getRuleActionsByRuleIds(ruleIds: string[]): Promise<AlertRuleActionRow[]>;
    createSilence(input: {
        organizationId: string;
        ruleId: string | null;
        createdBy: string;
        comment: string | null;
        startsAt: Date;
        endsAt: Date;
        matchers: Record<string, unknown>;
    }): Promise<AlertSilenceRow>;
    listSilences(organizationId: string, active: boolean | undefined, limit: number, offset: number): Promise<{
        data: AlertSilenceRow[];
        total: number;
    }>;
    expireSilence(organizationId: string, id: string): Promise<void>;
    findActiveSilences(organizationId: string, ruleId: string | null): Promise<AlertSilenceRow[]>;
    createEscalationPolicy(input: {
        organizationId: string;
        name: string;
        description: string | null;
        repeatIntervalMinutes: number | null;
        maxRepeats: number;
        isActive: boolean;
    }): Promise<AlertEscalationPolicyRow>;
    listEscalationPolicies(organizationId: string, limit: number, offset: number): Promise<{
        data: AlertEscalationPolicyRow[];
        total: number;
    }>;
    findEscalationPolicy(organizationId: string, id: string): Promise<AlertEscalationPolicyRow | null>;
    deleteEscalationPolicy(organizationId: string, id: string): Promise<void>;
    upsertEscalationStep(policyId: string, input: {
        stepNumber: number;
        waitMinutes: number;
        connectorIds: string[];
        routeIds: string[];
        notifyOnCall: boolean;
        customMessageTemplate: string | null;
        templateId: string | null;
        isActive: boolean;
    }): Promise<AlertEscalationStepRow>;
    listEscalationSteps(policyId: string): Promise<AlertEscalationStepRow[]>;
    listEscalationStepsByPolicyIds(policyIds: string[]): Promise<AlertEscalationStepRow[]>;
    createTemplate(input: {
        organizationId: string;
        name: string;
        templateType: string;
        content: string;
        variablesSchema: unknown[];
        defaultForSeverity: string | null;
        connectorType: string | null;
        isDefault: boolean;
        sampleData: Record<string, unknown>;
    }): Promise<AlertTemplateRow>;
    findTemplate(organizationId: string, id: string): Promise<AlertTemplateRow | null>;
    listTemplates(organizationId: string, limit: number, offset: number): Promise<{
        data: AlertTemplateRow[];
        total: number;
    }>;
    deleteTemplate(organizationId: string, id: string): Promise<void>;
    createRoutingRule(input: {
        organizationId: string;
        name: string;
        description: string | null;
        priority: number;
        conditions: Record<string, unknown>;
        targetConnectorIds: string[];
        targetRouteIds: string[];
        fallbackConnectorIds: string[];
        templateId: string | null;
        isActive: boolean;
    }): Promise<AlertRoutingRuleRow>;
    listRoutingRules(organizationId: string): Promise<AlertRoutingRuleRow[]>;
    findRoutingRule(organizationId: string, id: string): Promise<AlertRoutingRuleRow | null>;
    deleteRoutingRule(organizationId: string, id: string): Promise<void>;
}
//# sourceMappingURL=alert-config.repository.d.ts.map