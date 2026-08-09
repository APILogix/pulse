import { createHash } from 'node:crypto';
import type { AlertRuleRow } from '../rules/rules.types.js';
import type { EffectiveRule, EvaluationScope } from '../policy/resolve-rule.js';

export interface EffectiveProjectRule {
  organizationId: string;
  projectId: string;
  ruleId: string;
  bindingId: string;
  ruleRevision: number;
  scope: EvaluationScope;
  enabled: boolean;
  severity: EffectiveRule['severity'];
  cooldownSeconds: number;
  deduplicationWindowSeconds: number;
  evaluationIntervalSeconds: number;
  autoResolveAfterMinutes: number | null;
  consecutiveBreaches: number;
  conditions: EffectiveRule['conditions'];
  requestedChannels: string[];
  recipientOverrides: Record<string, unknown> | null;
  escalationPolicyId: string | null;
  hash: string;
}

export function buildEffectiveProjectRule(
  rule: AlertRuleRow & { current_revision: number },
  effective: EffectiveRule,
  scope: EvaluationScope,
): EffectiveProjectRule | null {
  if (!scope.projectId || !effective.enabled || !effective.bindingId) return null;

  const contract = {
    organizationId: rule.organization_id,
    projectId: scope.projectId,
    ruleId: rule.id,
    bindingId: effective.bindingId,
    ruleRevision: rule.current_revision,
    scope: {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      environment: scope.environment ?? null,
      service: scope.service ?? null,
      endpoint: scope.endpoint ?? null,
    },
    enabled: effective.enabled,
    severity: effective.severity,
    cooldownSeconds: effective.cooldownSeconds,
    deduplicationWindowSeconds: effective.deduplicationWindowSeconds,
    evaluationIntervalSeconds: effective.evaluationIntervalSeconds,
    autoResolveAfterMinutes: effective.autoResolveAfterMinutes,
    consecutiveBreaches: effective.consecutiveBreaches,
    conditions: effective.conditions,
    requestedChannels: [...effective.requestedChannels].sort(),
    recipientOverrides: effective.recipientOverrides,
    escalationPolicyId: effective.escalationPolicyId,
  };

  return { ...contract, hash: hashCanonical(contract) };
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
