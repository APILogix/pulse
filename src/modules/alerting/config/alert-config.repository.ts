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
import { pool as primaryPool } from '../../../config/database.js';
import { RulesRepository } from '../rules/rules.repository.js';
import { SilencesRepository } from '../silences/silences.repository.js';
import { PoliciesRepository } from '../policies/policies.repository.js';
import { TemplatesRepository } from '../templates/templates.repository.js';
import { RoutingRepository } from '../routing/routing.repository.js';
import { assertAlertingPool, type AlertingPoolTarget } from '../runtime/runtime-pool.js';
import type { CreateRuleInput, RuleConditionInsert, RuleActionInsert } from '../rules/rules.repository.js';
import type {
  AlertRuleRow,
  AlertRuleConditionRow,
  AlertRuleActionRow,
  AlertSilenceRow,
  AlertEscalationPolicyRow,
  AlertEscalationStepRow,
  AlertTemplateRow,
  AlertRoutingRuleRow,
  ListRulesQuery,
} from '../types.js';

export class AlertConfigRepository {
  private readonly db: Pool;
  private readonly rules: RulesRepository;
  private readonly silences: SilencesRepository;
  private readonly policies: PoliciesRepository;
  private readonly templates: TemplatesRepository;
  private readonly routing: RoutingRepository;

  /**
   * @param db The PRIMARY control-plane pool. Defaults to config/database.ts so
   *   existing construction sites keep working unchanged.
   */
  constructor(db: Pool = primaryPool) {
    this.db = db;
    this.rules = new RulesRepository(db);
    this.silences = new SilencesRepository(db);
    this.policies = new PoliciesRepository(db);
    this.templates = new TemplatesRepository(db);
    this.routing = new RoutingRepository(db);
  }

  /** The pool this repository is bound to. Exposed for boot verification only. */
  get connectionPool(): Pool {
    return this.db;
  }

  /**
   * Boot assertion: prove this pool really is the control plane by resolving the
   * alert configuration tables. Throws AlertingRuntimePoolError otherwise.
   */
  async assertConfigPool(logger: Logger): Promise<AlertingPoolTarget> {
    return assertAlertingPool(this.db, 'alerting_config', logger);
  }

  /** Config-scoped transaction. Never spans the Log DB (ADR-0006). */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Rules + conditions + actions ────────────────────────────────────────────
  async createRule(input: CreateRuleInput): Promise<AlertRuleRow> {
    return this.rules.createRule(input);
  }

  async findRuleById(organizationId: string, id: string): Promise<AlertRuleRow | null> {
    return this.rules.findRuleById(organizationId, id);
  }

  async findRuleByPresetKey(organizationId: string, presetKey: string): Promise<AlertRuleRow | null> {
    return this.rules.findRuleByPresetKey(organizationId, presetKey);
  }

  async listRules(
    organizationId: string,
    query: ListRulesQuery,
  ): Promise<{ data: AlertRuleRow[]; total: number }> {
    return this.rules.listRules(organizationId, query);
  }

  async updateRule(
    organizationId: string,
    id: string,
    fields: Record<string, unknown>,
    conditions: RuleConditionInsert[] | null,
    actions: RuleActionInsert[] | null,
    updatedBy: string,
  ): Promise<AlertRuleRow> {
    return this.rules.updateRule(organizationId, id, fields, conditions, actions, updatedBy);
  }

  async softDeleteRule(organizationId: string, id: string): Promise<void> {
    return this.rules.softDeleteRule(organizationId, id);
  }

  async setRuleEnabled(organizationId: string, id: string, enabled: boolean): Promise<AlertRuleRow> {
    return this.rules.setRuleEnabled(organizationId, id, enabled);
  }

  async getRuleConditions(ruleId: string): Promise<AlertRuleConditionRow[]> {
    return this.rules.getRuleConditions(ruleId);
  }

  async getRuleActions(ruleId: string): Promise<AlertRuleActionRow[]> {
    return this.rules.getRuleActions(ruleId);
  }

  async getRuleActionsByRuleIds(ruleIds: string[]): Promise<AlertRuleActionRow[]> {
    return this.rules.getRuleActionsByRuleIds(ruleIds);
  }

  // ── Silences (ad-hoc suppression configuration) ─────────────────────────────
  async createSilence(input: {
    organizationId: string; ruleId: string | null; createdBy: string; comment: string | null;
    startsAt: Date; endsAt: Date; matchers: Record<string, unknown>;
  }): Promise<AlertSilenceRow> {
    return this.silences.createSilence(input);
  }

  async listSilences(
    organizationId: string,
    active: boolean | undefined,
    limit: number,
    offset: number,
  ): Promise<{ data: AlertSilenceRow[]; total: number }> {
    return this.silences.listSilences(organizationId, active, limit, offset);
  }

  async expireSilence(organizationId: string, id: string): Promise<void> {
    return this.silences.expireSilence(organizationId, id);
  }

  async findActiveSilences(organizationId: string, ruleId: string | null): Promise<AlertSilenceRow[]> {
    return this.silences.findActiveSilences(organizationId, ruleId);
  }

  // ── Escalation policies + steps ─────────────────────────────────────────────
  async createEscalationPolicy(input: {
    organizationId: string; name: string; description: string | null;
    repeatIntervalMinutes: number | null; maxRepeats: number; isActive: boolean;
  }): Promise<AlertEscalationPolicyRow> {
    return this.policies.createEscalationPolicy(input);
  }

  async listEscalationPolicies(
    organizationId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: AlertEscalationPolicyRow[]; total: number }> {
    return this.policies.listEscalationPolicies(organizationId, limit, offset);
  }

  async findEscalationPolicy(
    organizationId: string,
    id: string,
  ): Promise<AlertEscalationPolicyRow | null> {
    return this.policies.findEscalationPolicy(organizationId, id);
  }

  async deleteEscalationPolicy(organizationId: string, id: string): Promise<void> {
    return this.policies.deleteEscalationPolicy(organizationId, id);
  }

  async upsertEscalationStep(policyId: string, input: {
    stepNumber: number; waitMinutes: number; connectorIds: string[]; routeIds: string[];
    notifyOnCall: boolean; customMessageTemplate: string | null; templateId: string | null; isActive: boolean;
  }): Promise<AlertEscalationStepRow> {
    return this.policies.upsertEscalationStep(policyId, input);
  }

  async listEscalationSteps(policyId: string): Promise<AlertEscalationStepRow[]> {
    return this.policies.listEscalationSteps(policyId);
  }

  async listEscalationStepsByPolicyIds(policyIds: string[]): Promise<AlertEscalationStepRow[]> {
    return this.policies.listEscalationStepsByPolicyIds(policyIds);
  }

  // ── Templates ───────────────────────────────────────────────────────────────
  async createTemplate(input: {
    organizationId: string; name: string; templateType: string; content: string;
    variablesSchema: unknown[]; defaultForSeverity: string | null; connectorType: string | null;
    isDefault: boolean; sampleData: Record<string, unknown>;
  }): Promise<AlertTemplateRow> {
    return this.templates.createTemplate(input);
  }

  async findTemplate(organizationId: string, id: string): Promise<AlertTemplateRow | null> {
    return this.templates.findTemplate(organizationId, id);
  }

  async listTemplates(
    organizationId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: AlertTemplateRow[]; total: number }> {
    return this.templates.listTemplates(organizationId, limit, offset);
  }

  async deleteTemplate(organizationId: string, id: string): Promise<void> {
    return this.templates.deleteTemplate(organizationId, id);
  }

  // ── Routing rules ───────────────────────────────────────────────────────────
  async createRoutingRule(input: {
    organizationId: string; name: string; description: string | null; priority: number;
    conditions: Record<string, unknown>; targetConnectorIds: string[]; targetRouteIds: string[];
    fallbackConnectorIds: string[]; templateId: string | null; isActive: boolean;
  }): Promise<AlertRoutingRuleRow> {
    return this.routing.createRoutingRule(input);
  }

  async listRoutingRules(organizationId: string): Promise<AlertRoutingRuleRow[]> {
    return this.routing.listRoutingRules(organizationId);
  }

  async findRoutingRule(organizationId: string, id: string): Promise<AlertRoutingRuleRow | null> {
    return this.routing.findRoutingRule(organizationId, id);
  }

  async deleteRoutingRule(organizationId: string, id: string): Promise<void> {
    return this.routing.deleteRoutingRule(organizationId, id);
  }
}
