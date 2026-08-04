import type { EffectiveThreshold } from './resolve-threshold.js';
import type { EffectiveRule, EvaluationScope, RuleResolutionTraceEntry } from './resolve-rule.js';

export interface AlertCandidate {
  organizationId: string;
  projectId?: string | null;
  environment?: string | null;
  service?: string | null;
  endpoint?: string | null;
  ruleId: string;
  observedAt: Date;
  source: string;
  values: Record<string, unknown>;
  labels?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

export interface EffectiveAlertPolicy {
  policyId: string;
  version: number;
  organizationId: string;
  ruleId: string;
  scope: EvaluationScope;
  enabled: boolean;
  severity: EffectiveRule['severity'];
  cooldownSeconds: number;
  deduplicationWindowSeconds: number;
  evaluationIntervalSeconds: number;
  autoResolveAfterMinutes: number | null;
  consecutiveBreaches: number;
  conditions: EffectiveRule['conditions'];
  thresholds: EffectiveThreshold[];
  requestedChannels: string[];
  recipientOverrides: Record<string, unknown> | null;
  escalationPolicyId: string | null;
  trace: RuleResolutionTraceEntry[];
}

export interface PolicyResolutionResult {
  policy: EffectiveAlertPolicy;
  conflict: boolean;
  appliedBindingIds: string[];
}
