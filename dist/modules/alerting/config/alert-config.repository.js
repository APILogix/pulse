import { pool as primaryPool } from '../../../config/database.js';
import { RulesRepository } from '../rules/rules.repository.js';
import { SilencesRepository } from '../silences/silences.repository.js';
import { PoliciesRepository } from '../policies/policies.repository.js';
import { TemplatesRepository } from '../templates/templates.repository.js';
import { RoutingRepository } from '../routing/routing.repository.js';
import { assertAlertingPool } from '../runtime/runtime-pool.js';
export class AlertConfigRepository {
    db;
    rules;
    silences;
    policies;
    templates;
    routing;
    /**
     * @param db The PRIMARY control-plane pool. Defaults to config/database.ts so
     *   existing construction sites keep working unchanged.
     */
    constructor(db = primaryPool) {
        this.db = db;
        this.rules = new RulesRepository(db);
        this.silences = new SilencesRepository(db);
        this.policies = new PoliciesRepository(db);
        this.templates = new TemplatesRepository(db);
        this.routing = new RoutingRepository(db);
    }
    /** The pool this repository is bound to. Exposed for boot verification only. */
    get connectionPool() {
        return this.db;
    }
    /**
     * Boot assertion: prove this pool really is the control plane by resolving the
     * alert configuration tables. Throws AlertingRuntimePoolError otherwise.
     */
    async assertConfigPool(logger) {
        return assertAlertingPool(this.db, 'alerting_config', logger);
    }
    /** Config-scoped transaction. Never spans the Log DB (ADR-0006). */
    async withTransaction(fn) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw err;
        }
        finally {
            client.release();
        }
    }
    // ── Rules + conditions + actions ────────────────────────────────────────────
    async createRule(input) {
        return this.rules.createRule(input);
    }
    async findRuleById(organizationId, id) {
        return this.rules.findRuleById(organizationId, id);
    }
    async listRules(organizationId, query) {
        return this.rules.listRules(organizationId, query);
    }
    async updateRule(organizationId, id, fields, conditions, actions, updatedBy) {
        return this.rules.updateRule(organizationId, id, fields, conditions, actions, updatedBy);
    }
    async softDeleteRule(organizationId, id) {
        return this.rules.softDeleteRule(organizationId, id);
    }
    async setRuleEnabled(organizationId, id, enabled) {
        return this.rules.setRuleEnabled(organizationId, id, enabled);
    }
    async getRuleConditions(ruleId) {
        return this.rules.getRuleConditions(ruleId);
    }
    async getRuleActions(ruleId) {
        return this.rules.getRuleActions(ruleId);
    }
    async getRuleActionsByRuleIds(ruleIds) {
        return this.rules.getRuleActionsByRuleIds(ruleIds);
    }
    // ── Silences (ad-hoc suppression configuration) ─────────────────────────────
    async createSilence(input) {
        return this.silences.createSilence(input);
    }
    async listSilences(organizationId, active, limit, offset) {
        return this.silences.listSilences(organizationId, active, limit, offset);
    }
    async expireSilence(organizationId, id) {
        return this.silences.expireSilence(organizationId, id);
    }
    async findActiveSilences(organizationId, ruleId) {
        return this.silences.findActiveSilences(organizationId, ruleId);
    }
    // ── Escalation policies + steps ─────────────────────────────────────────────
    async createEscalationPolicy(input) {
        return this.policies.createEscalationPolicy(input);
    }
    async listEscalationPolicies(organizationId, limit, offset) {
        return this.policies.listEscalationPolicies(organizationId, limit, offset);
    }
    async findEscalationPolicy(organizationId, id) {
        return this.policies.findEscalationPolicy(organizationId, id);
    }
    async deleteEscalationPolicy(organizationId, id) {
        return this.policies.deleteEscalationPolicy(organizationId, id);
    }
    async upsertEscalationStep(policyId, input) {
        return this.policies.upsertEscalationStep(policyId, input);
    }
    async listEscalationSteps(policyId) {
        return this.policies.listEscalationSteps(policyId);
    }
    async listEscalationStepsByPolicyIds(policyIds) {
        return this.policies.listEscalationStepsByPolicyIds(policyIds);
    }
    // ── Templates ───────────────────────────────────────────────────────────────
    async createTemplate(input) {
        return this.templates.createTemplate(input);
    }
    async findTemplate(organizationId, id) {
        return this.templates.findTemplate(organizationId, id);
    }
    async listTemplates(organizationId, limit, offset) {
        return this.templates.listTemplates(organizationId, limit, offset);
    }
    async deleteTemplate(organizationId, id) {
        return this.templates.deleteTemplate(organizationId, id);
    }
    // ── Routing rules ───────────────────────────────────────────────────────────
    async createRoutingRule(input) {
        return this.routing.createRoutingRule(input);
    }
    async listRoutingRules(organizationId) {
        return this.routing.listRoutingRules(organizationId);
    }
    async findRoutingRule(organizationId, id) {
        return this.routing.findRoutingRule(organizationId, id);
    }
    async deleteRoutingRule(organizationId, id) {
        return this.routing.deleteRoutingRule(organizationId, id);
    }
}
//# sourceMappingURL=alert-config.repository.js.map