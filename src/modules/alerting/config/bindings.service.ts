/**
 * Alert rule binding service — composition layer for bindings and effective rule resolution.
 *
 * Architecture: docs/alerting-redesign/adr/0004-rule-inheritance-model.md
 *               docs/alerting-redesign/08-implementation-plan.md Increment 2 (API)
 *
 * This is deliberately thin. It composes two things that must not be coupled:
 *   - AlertConfigRepository  → the rule definition and its conditions (primary DB)
 *   - AlertRuleBindingsRepository → scope behaviour (primary DB)
 * and calls the PURE resolver. Resolution logic itself lives in policy/resolve-rule.ts and is
 * never duplicated here.
 *
 * Nothing in the evaluation path calls this yet: Increment 2 ships the capability dormant.
 */
import type { FastifyBaseLogger } from 'fastify';
import { AlertNotFoundError } from '../types.js';
import {
  hasEqualDepthConflict,
  resolveEffectiveRule,
  type EffectiveRule,
  type EvaluationScope,
} from '../policy/resolve-rule.js';
import { recordBindingConflict } from '../policy/metrics.js';
import { resolveAllEffectiveThresholds, type EffectiveThreshold } from '../policy/resolve-threshold.js';
import { AlertConfigRepository } from './alert-config.repository.js';
import { AlertRuleBindingsRepository, type AlertRuleRevisionRow } from './bindings.repository.js';
import type {
  CreateBindingBody,
  EffectiveRuleQuery,
  UpdateBindingBody,
} from './bindings.types.js';
import type { AlertRuleBindingRow } from '../policy/resolve-rule.js';

export interface EffectiveRuleResult {
  rule: EffectiveRule;
  thresholds: EffectiveThreshold[];
  /** True when two bindings tied at the same depth and the tie-break decided. */
  conflict: boolean;
  /** Bindings that matched the requested scope, deepest last. */
  appliedBindingIds: string[];
}

export interface BindingsServiceDeps {
  config?: AlertConfigRepository;
  bindings?: AlertRuleBindingsRepository;
  logger: FastifyBaseLogger;
}

export class AlertRuleBindingsService {
  private readonly config: AlertConfigRepository;
  private readonly bindings: AlertRuleBindingsRepository;
  private readonly log: FastifyBaseLogger;

  constructor(deps: BindingsServiceDeps) {
    this.config = deps.config ?? new AlertConfigRepository();
    this.bindings = deps.bindings ?? new AlertRuleBindingsRepository();
    this.log = deps.logger.child({ component: 'alert-rule-bindings' });
  }

  async list(organizationId: string, ruleId: string): Promise<AlertRuleBindingRow[]> {
    return this.bindings.listByRule(organizationId, ruleId);
  }

  async get(
    organizationId: string,
    ruleId: string,
    bindingId: string,
  ): Promise<AlertRuleBindingRow> {
    const binding = await this.bindings.findById(organizationId, ruleId, bindingId);
    if (!binding) throw new AlertNotFoundError('Alert rule binding');
    return binding;
  }

  async create(
    organizationId: string,
    ruleId: string,
    body: CreateBindingBody,
    actorUserId: string | null,
  ): Promise<AlertRuleBindingRow> {
    const binding = await this.bindings.create(organizationId, ruleId, body, actorUserId);
    this.log.info(
      {
        orgId: organizationId, ruleId, bindingId: binding.id,
        scopeType: binding.scope_type, mode: binding.mode,
      },
      'Alert rule binding created',
    );
    return binding;
  }

  async update(
    organizationId: string,
    ruleId: string,
    bindingId: string,
    body: UpdateBindingBody,
    actorUserId: string | null,
  ): Promise<AlertRuleBindingRow> {
    const binding = await this.bindings.update(organizationId, ruleId, bindingId, body, actorUserId);
    this.log.info({ orgId: organizationId, ruleId, bindingId }, 'Alert rule binding updated');
    return binding;
  }

  async remove(
    organizationId: string,
    ruleId: string,
    bindingId: string,
    actorUserId: string | null,
  ): Promise<void> {
    await this.bindings.softDelete(organizationId, ruleId, bindingId, actorUserId);
    this.log.info({ orgId: organizationId, ruleId, bindingId }, 'Alert rule binding deleted');
  }

  async listRevisions(
    organizationId: string,
    ruleId: string,
    limit?: number,
  ): Promise<AlertRuleRevisionRow[]> {
    return this.bindings.listRevisions(organizationId, ruleId, limit);
  }

  /**
   * Resolve the ONE effective rule for a scope.
   *
   * The returned trace is the debugging surface for inheritance: it names every binding that
   * contributed and which fields it set, so "why did this fire at 0.5%?" has a direct answer.
   */
  async resolveEffective(
    organizationId: string,
    ruleId: string,
    query: EffectiveRuleQuery,
  ): Promise<EffectiveRuleResult> {
    const rule = await this.config.findRuleById(organizationId, ruleId);
    if (!rule) throw new AlertNotFoundError('Alert rule');

    const [conditions, bindings] = await Promise.all([
      this.config.getRuleConditions(ruleId),
      this.bindings.listByRule(organizationId, ruleId),
    ]);

    const scope: EvaluationScope = {
      organizationId,
      projectId: query.projectId ?? null,
      environment: query.environment ?? null,
      service: query.service ?? null,
      endpoint: query.endpoint ?? null,
    };

    const effective = resolveEffectiveRule(rule, conditions, bindings, scope);
    const conflict = hasEqualDepthConflict(bindings, scope);
    if (conflict) {
      recordBindingConflict(effective.resolvedScopeLevel);
      this.log.warn(
        { orgId: organizationId, ruleId, scopeLevel: effective.resolvedScopeLevel },
        'Two alert rule bindings tie at the same scope depth — resolution used the tie-break',
      );
    }

    return {
      rule: effective,
      thresholds: resolveAllEffectiveThresholds(effective),
      conflict,
      appliedBindingIds: effective.trace
        .map((entry) => entry.bindingId)
        .filter((id): id is string => id !== null),
    };
  }
}
