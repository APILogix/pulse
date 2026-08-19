import type { CreateRuleBody } from '../rules/rules.types.js';
import { DEFAULT_ALERT_PRESETS, type DefaultAlertPreset } from './presets.js';

export interface AlertRuleTemplate {
  key: string;
  name: string;
  description: string;
  category: 'default' | 'observability' | 'ai' | 'billing' | 'security' | 'integration';
  rule: CreateRuleBody;
}

function presetToTemplate(preset: DefaultAlertPreset): AlertRuleTemplate {
  return {
    key: preset.presetKey,
    name: preset.name,
    description: preset.description,
    category: preset.presetKey.startsWith('ai_') ? 'ai' : 'default',
    rule: {
      name: preset.name,
      description: preset.description,
      severity: preset.severity,
      enabled: false,
      evaluationIntervalSeconds: preset.evaluationIntervalSeconds,
      cooldownSeconds: preset.cooldownSeconds,
      autoResolveAfterMinutes: preset.autoResolveAfterMinutes ?? undefined,
      deduplicationWindowSeconds: preset.deduplicationWindowSeconds,
      groupingEnabled: false,
      groupingWaitSeconds: 300,
      labels: { template: true, templateKey: preset.presetKey },
      annotations: { template_key: preset.presetKey },
      metadata: preset.metadata ?? {},
      conditions: [{
        conditionType: 'threshold',
        fieldPath: preset.condition.fieldPath,
        operator: preset.condition.operator,
        thresholdValue: preset.condition.thresholdValue,
        lookbackMinutes: preset.condition.lookbackMinutes,
        aggregateFunction: preset.condition.aggregateFunction,
        isRequired: true,
        orderIndex: 0,
      }],
      actions: [{
        actionType: 'notify',
        priority: 100,
        orderIndex: 0,
        throttleDurationSeconds: 0,
        actionConditions: { channel: 'in_app', audience: 'org_members' },
        isActive: true,
      }],
    },
  };
}

const OPTIONAL_ALERT_RULE_TEMPLATES: readonly AlertRuleTemplate[] = [
  {
    key: 'disk_usage_high',
    name: 'High disk usage',
    description: 'Average custom disk usage metric exceeds the threshold within the lookback window.',
    category: 'observability',
    rule: metricRule('High disk usage', 'metrics.disk.usage', 85),
  },
  {
    key: 'queue_lag_high',
    name: 'High queue lag',
    description: 'Average custom queue lag metric exceeds the threshold within the lookback window.',
    category: 'observability',
    rule: metricRule('High queue lag', 'metrics.queue.lag', 1000),
  },
  {
    key: 'cache_error_logs',
    name: 'Cache error logs',
    description: 'Logs contain cache connection or cache timeout failures.',
    category: 'observability',
    rule: logPatternRule('Cache error logs', 'cache timeout', 'error'),
  },
  {
    key: 'auth_failure_spike',
    name: 'Auth failure spike',
    description: 'Logs contain authentication failure patterns within the lookback window.',
    category: 'security',
    rule: logPatternRule('Auth failure spike', 'authentication failed', 'warning'),
  },
  {
    key: 'webhook_delivery_failures',
    name: 'Webhook delivery failures',
    description: 'Logs contain webhook delivery failure patterns within the lookback window.',
    category: 'integration',
    rule: logPatternRule('Webhook delivery failures', 'webhook delivery failed', 'error'),
  },
  {
    key: 'payment_failure_spike',
    name: 'Payment failure spike',
    description: 'Average custom payment failure metric exceeds the threshold within the lookback window.',
    category: 'billing',
    rule: metricRule('Payment failure spike', 'metrics.payment.failures', 5, 'error'),
  },
  {
    key: 'ai_token_volume_spike',
    name: 'AI token volume spike',
    description: 'AI token usage within the lookback window exceeds the threshold.',
    category: 'ai',
    rule: aiRule('AI token volume spike', 'ai.tokens.used', 100000, 'warning'),
  },
] as const;

export const ALERT_RULE_TEMPLATES: readonly AlertRuleTemplate[] = [
  ...DEFAULT_ALERT_PRESETS.map(presetToTemplate),
  ...OPTIONAL_ALERT_RULE_TEMPLATES,
] as const;

export function listAlertRuleTemplates(): readonly AlertRuleTemplate[] {
  return ALERT_RULE_TEMPLATES;
}

export function getAlertRuleTemplate(key: string): AlertRuleTemplate | null {
  return ALERT_RULE_TEMPLATES.find((template) => template.key === key) ?? null;
}

function metricRule(name: string, fieldPath: string, threshold: number, severity: CreateRuleBody['severity'] = 'warning'): CreateRuleBody {
  return {
    name,
    severity,
    enabled: false,
    evaluationIntervalSeconds: 120,
    cooldownSeconds: 1800,
    autoResolveAfterMinutes: 30,
    deduplicationWindowSeconds: 7200,
    groupingEnabled: false,
    groupingWaitSeconds: 300,
    labels: { template: true },
    annotations: {},
    metadata: {},
    conditions: [{
      conditionType: 'threshold',
      fieldPath,
      operator: 'gte',
      thresholdValue: threshold,
      lookbackMinutes: 10,
      aggregateFunction: 'avg',
      isRequired: true,
      orderIndex: 0,
    }],
    actions: [defaultInAppAction()],
  };
}

function logPatternRule(name: string, pattern: string, severity: CreateRuleBody['severity']): CreateRuleBody {
  return {
    name,
    severity,
    enabled: false,
    evaluationIntervalSeconds: 120,
    cooldownSeconds: 1800,
    autoResolveAfterMinutes: 60,
    deduplicationWindowSeconds: 7200,
    groupingEnabled: false,
    groupingWaitSeconds: 300,
    labels: { template: true },
    annotations: {},
    metadata: {},
    conditions: [{
      conditionType: 'threshold',
      fieldPath: 'logs.matches',
      operator: 'contains',
      thresholdValue: pattern,
      lookbackMinutes: 15,
      isRequired: true,
      orderIndex: 0,
    }],
    actions: [defaultInAppAction()],
  };
}

function aiRule(name: string, fieldPath: string, threshold: number, severity: CreateRuleBody['severity']): CreateRuleBody {
  return {
    name,
    severity,
    enabled: false,
    evaluationIntervalSeconds: 300,
    cooldownSeconds: 1800,
    autoResolveAfterMinutes: 60,
    deduplicationWindowSeconds: 7200,
    groupingEnabled: false,
    groupingWaitSeconds: 300,
    labels: { template: true },
    annotations: {},
    metadata: {},
    conditions: [{
      conditionType: 'threshold',
      fieldPath,
      operator: 'gte',
      thresholdValue: threshold,
      lookbackMinutes: 60,
      isRequired: true,
      orderIndex: 0,
    }],
    actions: [defaultInAppAction()],
  };
}

function defaultInAppAction(): CreateRuleBody['actions'][number] {
  return {
    actionType: 'notify',
    priority: 100,
    orderIndex: 0,
    throttleDurationSeconds: 0,
    actionConditions: { channel: 'in_app', audience: 'org_members' },
    isActive: true,
  };
}
