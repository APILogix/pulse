import type { FastifyBaseLogger } from 'fastify';
import type { RequestMeta } from '../../service.js';
import { ProjectMemberRole } from '../../core/project.types.js';
import { BaseProjectService } from '../../shared/base.service.js';
import { ProjectError } from '../../shared/utils.js';
import { ProjectPolicyRepository } from './project-policy.repository.js';
import { AlertConfigRepository } from '../../../alerting/config/alert-config.repository.js';
import { AlertRuleBindingsRepository } from '../../../alerting/config/bindings.repository.js';
import type { AlertRuleBindingRecord } from '../../../alerting/config/bindings.repository.js';
import type { SubscribePolicyBody, UpdatePolicyOverrideBody, UpdatePolicySubscriptionBody } from './project-policy.types.js';
const CANONICAL_CHANNELS = new Set(['in_app', 'email', 'slack', 'discord', 'teams', 'pagerduty', 'webhook', 'sms']);

function canonicalChannels(values: string[]): Array<'in_app' | 'email' | 'slack' | 'discord' | 'teams' | 'pagerduty' | 'webhook' | 'sms'> {
  const invalid = values.filter((value) => !CANONICAL_CHANNELS.has(value));
  if (invalid.length > 0) throw new ProjectError('UNSUPPORTED_POLICY_OVERRIDE', 'Unsupported notification channel', 422);
  return values as Array<'in_app' | 'email' | 'slack' | 'discord' | 'teams' | 'pagerduty' | 'webhook' | 'sms'>;
}

export class ProjectPolicyService {
  constructor(
    private readonly repository: ProjectPolicyRepository,
    private readonly projectAccess: BaseProjectService,
    private readonly logger: FastifyBaseLogger,
    private readonly config = new AlertConfigRepository(),
    private readonly bindings = new AlertRuleBindingsRepository(),
  ) {}

  async list(organizationId: string, projectId: string, userId: string) {
    await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.VIEWER);
    const bindings = await this.bindings.listByOrganization(organizationId);
    return bindings.filter((binding) => binding.project_id === projectId).map((binding) => this.bindingDto(binding, binding.rule_id, binding.mode === 'disable' ? 'disabled' : 'subscribed'));
  }

  async subscribe(organizationId: string, projectId: string, meta: RequestMeta, body: SubscribePolicyBody) {
    const userId = meta.actorUserId;
    await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
    const rule = await this.requireCanonicalRule(organizationId, body.policyId);
    let binding: AlertRuleBindingRecord;
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
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        throw new ProjectError('POLICY_SUBSCRIPTION_EXISTS', 'Project is already subscribed to this alerting policy', 409);
      }
      throw error;
    }
    const subscription = this.bindingDto(binding, rule.id, 'subscribed');
    await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_subscribed', entityType: 'alert_rule_binding', entityId: binding.id, newValues: { ruleId: rule.id, state: 'subscribed' } });
    return subscription;
  }

  async updateState(organizationId: string, projectId: string, meta: RequestMeta, subscriptionId: string, body: UpdatePolicySubscriptionBody) {
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

  async updateOverride(organizationId: string, projectId: string, meta: RequestMeta, subscriptionId: string, body: UpdatePolicyOverrideBody) {
    const userId = meta.actorUserId;
    await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
    if (body.maintenanceWindows !== undefined || body.muteSchedule !== undefined || body.environment !== undefined) {
      throw new ProjectError('UNSUPPORTED_POLICY_OVERRIDE', 'Maintenance windows, mute schedules, and environment overrides must use their canonical configuration APIs', 422);
    }
    const binding = await this.requireBinding(organizationId, projectId, subscriptionId);
    const patch = {
      mode: 'override' as const,
      ...(body.threshold ? { thresholdOverrides: body.threshold } : {}),
      ...(body.cooldownSeconds !== undefined ? { cooldownSeconds: body.cooldownSeconds } : {}),
      ...(body.evaluationWindowSeconds !== undefined ? { evaluationIntervalSeconds: body.evaluationWindowSeconds } : {}),
      ...(body.severity !== undefined ? { severity: body.severity } : {}),
      ...(body.channels !== undefined ? { requestedChannels: body.channels === null ? null : canonicalChannels(body.channels) } : {}),
      ...(body.escalationPolicyId !== undefined ? { escalationPolicyId: body.escalationPolicyId } : {}),
    };
    const updated = await this.bindings.update(organizationId, binding.rule_id, binding.id, patch, userId);
    await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_override_updated', entityType: 'alert_rule_binding', entityId: updated.id, newValues: { ruleId: binding.rule_id } });
    return this.bindingDto(updated, binding.rule_id, 'subscribed');
  }

  async remove(organizationId: string, projectId: string, meta: RequestMeta, subscriptionId: string) {
    const userId = meta.actorUserId;
    await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.ADMIN);
    const binding = await this.requireBinding(organizationId, projectId, subscriptionId);
    await this.bindings.softDelete(organizationId, binding.rule_id, binding.id, userId);
    await this.projectAccess.audit(meta, { orgId: organizationId, projectId, action: 'alerting.policy_unsubscribed', entityType: 'alert_rule_binding', entityId: subscriptionId });
  }

  async resolve(organizationId: string, projectId: string, policyId: string, userId: string) {
    await this.projectAccess.requireProjectAccess(organizationId, projectId, userId, ProjectMemberRole.VIEWER);
    const rule = await this.requireCanonicalRule(organizationId, policyId);
    const effective = await this.bindings.listByRule(organizationId, rule.id);
    const binding = effective.find((candidate) => candidate.project_id === projectId);
    if (!binding) throw new ProjectError('EFFECTIVE_POLICY_NOT_FOUND', 'Project is not subscribed to this alerting policy', 404);
    return this.bindingDto(binding, rule.id, binding.mode === 'disable' ? 'disabled' : 'subscribed');
  }

  async listEffective(organizationId: string, projectId: string, userId: string) {
    return this.list(organizationId, projectId, userId);
  }

  private async requireCanonicalRule(organizationId: string, policyId: string) {
    const direct = await this.config.findRuleById(organizationId, policyId);
    if (direct) return direct;
    const legacy = await this.repository.findPolicyIdentity(organizationId, policyId);
    const rule = await this.config.findRuleByPresetKey(organizationId, legacy?.slug ?? policyId);
    if (!rule) throw new ProjectError('POLICY_NOT_FOUND', 'Alerting policy is not mapped to a canonical organization rule', 404);
    return rule;
  }

  private async requireBinding(organizationId: string, projectId: string, bindingId: string): Promise<AlertRuleBindingRecord> {
    const binding = (await this.bindings.listByOrganization(organizationId))
      .find((candidate) => candidate.id === bindingId && candidate.project_id === projectId);
    if (!binding) throw new ProjectError('SUBSCRIPTION_NOT_FOUND', 'Canonical alert rule binding not found', 404);
    return binding;
  }

  private bindingDto(binding: AlertRuleBindingRecord, ruleId: string, state: string): Record<string, unknown> {
    return {
      id: binding.id,
      organization_id: binding.organization_id,
      project_id: binding.project_id,
      policy_id: ruleId,
      state,
      threshold: binding.threshold_overrides,
      cooldown_seconds: binding.cooldown_seconds,
      evaluation_window_seconds: binding.evaluation_interval_seconds,
      severity: binding.severity,
      channels: binding.requested_channels,
      escalation_policy_id: binding.escalation_policy_id,
      updated_at: binding.updated_at,
    };
  }
}
