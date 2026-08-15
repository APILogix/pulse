import { ProjectMemberRole } from '../../core/project.types.js';
import { BaseProjectService } from '../../shared/base.service.js';
import { ProjectError } from '../../shared/utils.js';
import { ProjectPolicyRepository } from './project-policy.repository.js';
import { AlertConfigRepository } from '../../../alerting/config/alert-config.repository.js';
import { AlertRuleBindingsRepository } from '../../../alerting/config/bindings.repository.js';
import { seedDefaultPresetsForOrg } from '../../../alerting/evaluator/presets.js';
const CANONICAL_CHANNELS = new Set(['in_app', 'email', 'slack', 'discord', 'teams', 'pagerduty', 'webhook', 'sms']);
function canonicalChannels(values) {
    const invalid = values.filter((value) => !CANONICAL_CHANNELS.has(value));
    if (invalid.length > 0)
        throw new ProjectError('UNSUPPORTED_POLICY_OVERRIDE', 'Unsupported notification channel', 422);
    return values;
}
export class ProjectPolicyService {
    repository;
    projectAccess;
    logger;
    config;
    bindings;
    constructor(repository, projectAccess, logger, config = new AlertConfigRepository(), bindings = new AlertRuleBindingsRepository()) {
        this.repository = repository;
        this.projectAccess = projectAccess;
        this.logger = logger;
        this.config = config;
        this.bindings = bindings;
    }
    async list(organizationId, projectId, userId) {
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.VIEWER);
        const bindings = (await this.bindings.listByOrganization(organizationId)).filter((binding) => binding.project_id === projectId);
        if (bindings.length === 0)
            return [];
        // Map rules and catalog policies for exact policyId resolution
        let rulesMap = new Map();
        try {
            const rulesList = await this.config.listRules(organizationId, { limit: 1000, offset: 0, sortOrder: 'asc' });
            rulesMap = new Map(rulesList.data.map((r) => [r.id, r]));
        }
        catch {
            // Fallback gracefully if rules listing encounters errors
        }
        let catalogSlugMap = new Map();
        let catalogIdSet = new Set();
        try {
            const catalogPolicies = await this.repository.getCatalogPolicies(organizationId);
            catalogSlugMap = new Map(catalogPolicies.map((p) => [p.slug, p.id]));
            catalogIdSet = new Set(catalogPolicies.map((p) => p.id));
        }
        catch {
            // Fallback gracefully
        }
        return bindings.map((binding) => {
            const rule = rulesMap.get(binding.rule_id);
            const meta = rule?.metadata ?? {};
            const metaPolicyId = typeof meta.policyId === 'string' ? meta.policyId : undefined;
            const slugPolicyId = rule?.preset_key ? catalogSlugMap.get(rule.preset_key) : undefined;
            const policyId = metaPolicyId || slugPolicyId || (catalogIdSet.has(binding.rule_id) ? binding.rule_id : binding.rule_id);
            const extra = {};
            if (policyId)
                extra.policyId = policyId;
            if (rule?.preset_key)
                extra.presetKey = rule.preset_key;
            if (rule?.name)
                extra.policyName = rule.name;
            return this.bindingDto(binding, binding.rule_id, binding.mode === 'disable' ? 'disabled' : 'subscribed', extra);
        });
    }
    async subscribe(organizationId, projectId, meta, body) {
        const userId = meta.actorUserId;
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
        const rule = await this.requireCanonicalRule(organizationId, body.policyId, userId);
        let binding;
        try {
            binding = await this.bindings.create(organizationId, rule.id, {
                scopeType: 'project',
                projectId,
                mode: 'inherit',
                enabled: true,
                priority: 100,
                thresholdOverrides: {},
                actionMode: 'inherit',
            }, userId);
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('already exists')) {
                throw new ProjectError('POLICY_SUBSCRIPTION_EXISTS', 'Project is already subscribed to this alerting policy', 409);
            }
            throw error;
        }
        const extraSub = {
            policyId: body.policyId,
        };
        if (rule.preset_key)
            extraSub.presetKey = rule.preset_key;
        if (rule.name)
            extraSub.policyName = rule.name;
        const subscription = this.bindingDto(binding, rule.id, 'subscribed', extraSub);
        await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_subscribed', entityType: 'alert_rule_binding', entityId: binding.id, newValues: { ruleId: rule.id, state: 'subscribed' } });
        return subscription;
    }
    async updateState(organizationId, projectId, meta, subscriptionId, body) {
        const userId = meta.actorUserId;
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
        const binding = await this.requireBinding(organizationId, projectId, subscriptionId);
        const updated = await this.bindings.update(organizationId, binding.rule_id, binding.id, {
            mode: body.state === 'disabled' || body.state === 'archived' ? 'disable' : 'inherit',
            enabled: body.state !== 'disabled' && body.state !== 'archived',
        }, userId);
        await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_subscription_state_updated', entityType: 'alert_rule_binding', entityId: updated.id, newValues: { state: body.state } });
        return this.bindingDto(updated, binding.rule_id, body.state);
    }
    async updateOverride(organizationId, projectId, meta, subscriptionId, body) {
        const userId = meta.actorUserId;
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
        if (body.maintenanceWindows !== undefined && body.maintenanceWindows !== null && body.maintenanceWindows.length > 0) {
            throw new ProjectError('UNSUPPORTED_POLICY_OVERRIDE', 'Maintenance windows must use their canonical configuration APIs', 422);
        }
        if (body.muteSchedule !== undefined && body.muteSchedule !== null && Object.keys(body.muteSchedule).length > 0) {
            throw new ProjectError('UNSUPPORTED_POLICY_OVERRIDE', 'Mute schedules must use their canonical configuration APIs', 422);
        }
        const binding = await this.requireBinding(organizationId, projectId, subscriptionId);
        const isClearing = (body.threshold === null || body.threshold === undefined || (typeof body.threshold === 'object' && Object.keys(body.threshold).length === 0)) &&
            body.cooldownSeconds === null &&
            body.evaluationWindowSeconds === null &&
            body.severity === null &&
            (body.channels === null || body.channels === undefined || body.channels.length === 0) &&
            body.escalationPolicyId === null;
        const patch = {
            mode: isClearing ? 'inherit' : 'override',
            thresholdOverrides: body.threshold ?? {},
            cooldownSeconds: body.cooldownSeconds ?? null,
            evaluationIntervalSeconds: body.evaluationWindowSeconds ?? null,
            severity: body.severity ?? null,
            requestedChannels: body.channels ? canonicalChannels(body.channels) : null,
            escalationPolicyId: body.escalationPolicyId ?? null,
        };
        const updated = await this.bindings.update(organizationId, binding.rule_id, binding.id, patch, userId);
        await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_override_updated', entityType: 'alert_rule_binding', entityId: updated.id, newValues: { ruleId: binding.rule_id } });
        return this.bindingDto(updated, binding.rule_id, 'subscribed');
    }
    async remove(organizationId, projectId, meta, subscriptionId) {
        const userId = meta.actorUserId;
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
        const binding = await this.requireBinding(organizationId, projectId, subscriptionId);
        await this.bindings.softDelete(organizationId, binding.rule_id, binding.id, userId);
        await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_unsubscribed', entityType: 'alert_rule_binding', entityId: subscriptionId });
    }
    async resolve(organizationId, projectId, policyId, userId) {
        await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.VIEWER);
        const rule = await this.requireCanonicalRule(organizationId, policyId, userId);
        const effective = await this.bindings.listByRule(organizationId, rule.id);
        const binding = effective.find((candidate) => candidate.project_id === projectId);
        if (!binding)
            throw new ProjectError('EFFECTIVE_POLICY_NOT_FOUND', 'Project is not subscribed to this alerting policy', 404);
        return this.bindingDto(binding, rule.id, binding.mode === 'disable' ? 'disabled' : 'subscribed');
    }
    async listEffective(organizationId, projectId, userId) {
        return this.list(organizationId, projectId, userId);
    }
    async requireCanonicalRule(organizationId, policyId, userId) {
        const direct = await this.config.findRuleById(organizationId, policyId);
        if (direct)
            return direct;
        const legacy = await this.repository.findPolicyIdentity(organizationId, policyId);
        const presetKey = legacy?.slug ?? policyId;
        let rule = await this.config.findRuleByPresetKey(organizationId, presetKey);
        if (rule)
            return rule;
        const seeded = await seedDefaultPresetsForOrg(this.config.connectionPool, organizationId);
        if (seeded > 0) {
            this.logger.info({ orgId: organizationId, seeded }, 'Seeded missing canonical alert presets for project policy subscription');
            rule = await this.config.findRuleByPresetKey(organizationId, presetKey);
            if (rule)
                return rule;
        }
        if (legacy) {
            const materialized = await this.repository.materializeCanonicalRuleFromPolicy(organizationId, policyId, userId);
            if (materialized) {
                rule = await this.config.findRuleById(organizationId, materialized.id);
                if (rule)
                    return rule;
            }
        }
        if (!rule)
            throw new ProjectError('POLICY_NOT_FOUND', 'Alerting policy is not mapped to a canonical organization rule', 404);
        return rule;
    }
    async requireBinding(organizationId, projectId, bindingId) {
        const binding = (await this.bindings.listByOrganization(organizationId))
            .find((candidate) => candidate.id === bindingId && candidate.project_id === projectId);
        if (!binding)
            throw new ProjectError('SUBSCRIPTION_NOT_FOUND', 'Canonical alert rule binding not found', 404);
        return binding;
    }
    bindingDto(binding, ruleId, state, extra) {
        const hasThreshold = binding.threshold_overrides && typeof binding.threshold_overrides === 'object' && Object.keys(binding.threshold_overrides).length > 0;
        const hasOverride = binding.mode === 'override' ||
            hasThreshold ||
            binding.cooldown_seconds != null ||
            binding.evaluation_interval_seconds != null ||
            binding.severity != null ||
            (binding.requested_channels != null && binding.requested_channels.length > 0) ||
            binding.escalation_policy_id != null;
        const catalogPolicyId = extra?.policyId ?? null;
        const overrideObj = hasOverride
            ? {
                id: binding.id,
                subscriptionId: binding.id,
                projectId: binding.project_id,
                policyId: catalogPolicyId ?? ruleId,
                threshold: hasThreshold ? binding.threshold_overrides : null,
                cooldownSeconds: binding.cooldown_seconds ?? null,
                evaluationWindowSeconds: binding.evaluation_interval_seconds ?? null,
                severity: binding.severity ?? null,
                channels: binding.requested_channels ?? null,
                escalationPolicyId: binding.escalation_policy_id ?? null,
                createdAt: binding.created_at,
                updatedAt: binding.updated_at,
            }
            : null;
        return {
            id: binding.id,
            organization_id: binding.organization_id,
            project_id: binding.project_id,
            policy_id: ruleId,
            rule_id: binding.rule_id,
            catalog_policy_id: catalogPolicyId,
            preset_key: extra?.presetKey ?? null,
            state,
            mode: binding.mode,
            override: overrideObj,
            threshold: binding.threshold_overrides,
            cooldown_seconds: binding.cooldown_seconds,
            evaluation_window_seconds: binding.evaluation_interval_seconds,
            severity: binding.severity,
            channels: binding.requested_channels,
            escalation_policy_id: binding.escalation_policy_id,
            created_at: binding.created_at,
            updated_at: binding.updated_at,
        };
    }
}
//# sourceMappingURL=project-policy.service.js.map