import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { pgboss } from '../../../lib/pgboss.js';
import { evaluateCondition, evaluateRule, type EvaluableCondition } from '../evaluator.js';
import type { AlertRuleConditionRow } from '../rules/rules.types.js';
import type { EffectiveRule, EvaluationScope } from '../policy/resolve-rule.js';
import { AlertRuntimeRepository, type AlertEngine } from './alert-runtime.repository.js';
import { AlertRuntimeRuleCatalog, type AlertRuntimeTier, type RuntimeRuleRow } from './rule-catalog.js';
import { AlertChannelRepository } from '../../projects/alerts/channels/channel.repository.js';
import { AlertConfigRepository } from '../config/alert-config.repository.js';
import { NotificationRoutingService } from './notification-routing.service.js';
import { AlertDecisionEngine } from '../decision/decision.engine.js';
import { resolveAllEffectiveThresholds } from '../policy/resolve-threshold.js';
import { buildEffectiveProjectRule } from './effective-rule-contract.js';
import type { ScopedEvent } from '../../ingestion/pipeline/telemetry-writer.js';
import { resolveTimestamp } from '../../ingestion/pipeline/event-normalizer.js';

export interface FastEvaluationInput {
  organizationId: string;
  projectId?: string | null;
  environment?: string | null;
  events?: ScopedEvent[];
  signals?: FastSignalInput[];
}

export interface FastSignalInput {
  projectId?: string | null;
  environment?: string | null;
  service?: string | null;
  endpoint?: string | null;
  source: 'deployment' | 'heartbeat' | 'connector' | 'security' | 'custom';
  kind: string;
  occurredAt?: string | Date;
  labels?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

export interface TierEvaluationInput {
  organizationId: string;
  tier: Exclude<AlertRuntimeTier, 'fast'>;
  maxScopes?: number;
}

export interface RuntimeEvaluationSummary {
  scopes: number;
  rules: number;
  evaluated: number;
  fired: number;
  recovered: number;
  suppressed: number;
  skipped: number;
  failed: number;
}

interface RuntimePayload {
  values: Record<string, unknown>;
  observedAt: Date;
  source: string;
  labels: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

interface ScopePayload {
  scope: EvaluationScope;
  payload: RuntimePayload;
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const ALL_ENVIRONMENTS = '__all__';
const DEFAULT_MAX_SCOPES = 500;

export class AlertRuntimeEngines {
  private readonly catalog: AlertRuntimeRuleCatalog;
  private readonly runtime: AlertRuntimeRepository;
  private readonly decision: AlertDecisionEngine;
  private readonly log: FastifyBaseLogger;

  constructor(
    logger: FastifyBaseLogger,
    private readonly logDb: Pool,
    private readonly controlDb: Pool,
    routing?: NotificationRoutingService,
  ) {
    this.catalog = new AlertRuntimeRuleCatalog(controlDb);
    this.runtime = new AlertRuntimeRepository(logDb);
    this.decision = new AlertDecisionEngine(logDb, logger, {
      routing: routing ?? new NotificationRoutingService({
        logger,
        channelRepository: new AlertChannelRepository(controlDb),
        configRepository: new AlertConfigRepository(controlDb),
      }),
    });
    this.log = logger.child({ component: 'alert-runtime-engines' });
  }

  async evaluateFast(input: FastEvaluationInput): Promise<RuntimeEvaluationSummary> {
    const summary = emptySummary();
    const scope: EvaluationScope = {
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      environment: input.environment ?? null,
    };
    const resolved = await this.catalog.resolveRulesForScope(input.organizationId, 'fast', scope);
    summary.scopes = 1;
    summary.rules = resolved.length;

    for (const scoped of input.events ?? []) {
      const payload = fastPayload(scoped);
      for (const candidate of resolved) {
        await this.evaluateCandidate(candidate.rule, candidate.effective, scope, payload, 'fast', summary);
      }
    }
    for (const signal of input.signals ?? []) {
      const signalScope: EvaluationScope = {
        organizationId: input.organizationId,
        projectId: signal.projectId ?? input.projectId ?? null,
        environment: signal.environment ?? input.environment ?? null,
        service: signal.service ?? null,
        endpoint: signal.endpoint ?? null,
      };
      const signalRules = signalScope.projectId === scope.projectId
        && signalScope.environment === scope.environment
        && signalScope.service === null
        && signalScope.endpoint === null
        ? resolved
        : await this.catalog.resolveRulesForScope(input.organizationId, 'fast', signalScope);
      const payload = fastSignalPayload(input.organizationId, signal);
      for (const candidate of signalRules) {
        await this.evaluateCandidate(candidate.rule, candidate.effective, signalScope, payload, 'fast', summary);
      }
    }
    return summary;
  }

  async evaluateTier(input: TierEvaluationInput): Promise<RuntimeEvaluationSummary> {
    const summary = emptySummary();
    const scopes = await this.loadRollupScopes(input.organizationId, input.tier, input.maxScopes ?? DEFAULT_MAX_SCOPES);
    summary.scopes = scopes.length;

    for (const scopePayload of scopes) {
      const resolved = await this.catalog.resolveRulesForScope(input.organizationId, input.tier, scopePayload.scope);
      summary.rules += resolved.length;
      for (const candidate of resolved) {
        await this.evaluateCandidate(
          candidate.rule,
          candidate.effective,
          scopePayload.scope,
          scopePayload.payload,
          input.tier === 'ai' ? 'reconcile' : 'window',
          summary,
        );
      }
    }
    return summary;
  }

  private async evaluateCandidate(
    rule: RuntimeRuleRow,
    effective: EffectiveRule,
    scope: EvaluationScope,
    payload: RuntimePayload,
    engine: AlertEngine,
    summary: RuntimeEvaluationSummary,
  ): Promise<void> {
    if (!effective.enabled || effective.conditions.length === 0) {
      summary.skipped += 1;
      return;
    }

    try {
      const evaluable: EvaluableCondition[] = effective.conditions.map((condition) => ({
        id: condition.id,
        conditionGroupId: condition.condition_group_id,
        fieldPath: condition.field_path,
        operator: condition.operator,
        thresholdValue: condition.threshold_value,
        isRequired: condition.is_required,
      }));
      const result = evaluateRule(payload.values, evaluable);
      const observed = firstObservedValue(result.conditionResults);
      const threshold = firstThresholdValue(effective.conditions);
      const scopeHash = hash([
        rule.organization_id,
        rule.id,
        effective.bindingId ?? '',
        scope.projectId ?? '',
        scope.environment ?? '',
        scope.service ?? '',
        scope.endpoint ?? '',
      ].join(':'));
      const states = await this.runtime.getRuleEvalStates([scopeHash]);
      const previous = states[0] ?? null;
      const now = payload.observedAt;
      summary.evaluated += 1;

      if (!result.matched) {
        await this.runtime.upsertRuleEvalState({
          scopeHash,
          organizationId: rule.organization_id,
          ruleId: rule.id,
          bindingId: effective.bindingId,
          projectId: scope.projectId ?? null,
          environment: scope.environment ?? null,
          service: scope.service ?? null,
          endpoint: scope.endpoint ?? null,
          consecutiveBreaches: 0,
          isBreaching: false,
          evaluatedAt: now,
          recoveredAt: previous?.is_breaching ? now : null,
        });
        if (previous?.is_breaching) {
          await this.appendDecision(rule, effective, scope, payload, engine, 'recovered', observed, threshold);
          summary.recovered += 1;
        }
        return;
      }

      const consecutive = (previous?.is_breaching ? previous.consecutive_breaches : 0) + 1;
      const shouldFire = consecutive >= effective.consecutiveBreaches;
      const coolingDown = previous?.last_fired_at
        ? now.getTime() - previous.last_fired_at.getTime() < effective.cooldownSeconds * 1000
        : false;

      await this.runtime.upsertRuleEvalState({
        scopeHash,
        organizationId: rule.organization_id,
        ruleId: rule.id,
        bindingId: effective.bindingId,
        projectId: scope.projectId ?? null,
        environment: scope.environment ?? null,
        service: scope.service ?? null,
        endpoint: scope.endpoint ?? null,
        consecutiveBreaches: consecutive,
        isBreaching: true,
        evaluatedAt: now,
        firedAt: shouldFire && !coolingDown ? now : null,
      });

      if (!shouldFire) {
        summary.suppressed += 1;
        return;
      }
      if (coolingDown) {
        summary.suppressed += 1;
        return;
      }

      await this.appendDecision(rule, effective, scope, payload, engine, 'fired', observed, threshold);
      summary.fired += 1;
    } catch (err) {
      summary.failed += 1;
      this.log.error({ err, ruleId: rule.id, orgId: rule.organization_id }, 'Runtime alert evaluation failed');
    }
  }

  private async appendDecision(
    rule: RuntimeRuleRow,
    effective: EffectiveRule,
    scope: EvaluationScope,
    payload: RuntimePayload,
    engine: AlertEngine,
    kind: 'fired' | 'recovered',
    observed: number | null,
    threshold: number | null,
  ): Promise<void> {
    const effectiveProjectRule = buildEffectiveProjectRule(rule, effective, scope);
    if (!effectiveProjectRule) return;
    const result = await this.decision.decide({
      organizationId: rule.organization_id,
      projectId: scope.projectId ?? null,
      environment: scope.environment ?? null,
      service: scope.service ?? null,
      endpoint: scope.endpoint ?? null,
      ruleRevision: rule.current_revision,
      policy: {
        policyId: `${rule.organization_id}:${rule.id}:${rule.current_revision}`,
        version: rule.current_revision,
        organizationId: rule.organization_id,
        projectId: scope.projectId ?? null,
        ruleId: rule.id,
        bindingId: effective.bindingId,
        ruleRevision: rule.current_revision,
        effectiveRuleHash: effectiveProjectRule.hash,
        scope,
        enabled: effective.enabled,
        severity: effective.severity,
        cooldownSeconds: effective.cooldownSeconds,
        deduplicationWindowSeconds: effective.deduplicationWindowSeconds,
        evaluationIntervalSeconds: effective.evaluationIntervalSeconds,
        autoResolveAfterMinutes: effective.autoResolveAfterMinutes,
        consecutiveBreaches: effective.consecutiveBreaches,
        conditions: effective.conditions,
        thresholds: resolveAllEffectiveThresholds(effective),
        requestedChannels: effective.requestedChannels,
        recipientOverrides: effective.recipientOverrides,
        escalationPolicyId: effective.escalationPolicyId,
        trace: effective.trace,
      },
      source: payload.source,
      observedAt: payload.observedAt,
      kind,
      observedValue: observed,
      thresholdValue: threshold,
      evidence: payload.evidence,
      labels: {
        ...payload.labels,
        rule_id: rule.id,
        binding_id: effective.bindingId,
        tier: engine,
      },
      annotations: {
        title: `${kind === 'fired' ? 'Alert' : 'Recovered'}: ${rule.name}`,
        message: kind === 'fired'
          ? `${rule.name} breached (${observed ?? 'n/a'} vs ${threshold ?? 'n/a'})`
          : `${rule.name} recovered`,
      },
      category: categoryForRule(effective.conditions, payload.source),
      conditionFieldPaths: effective.conditions.map((condition) => condition.field_path),
    });
    await Promise.all(result.notificationJobs.map((job) => this.enqueueNotificationJob(job.id)));
  }

  private async enqueueNotificationJob(notificationJobId: string): Promise<void> {
    await pgboss.send(
      'alert.notification-router',
      { notificationJobId },
      { retryLimit: 3, retryDelay: 10, retryBackoff: true, expireInSeconds: 600 } as never,
    );
  }

  private async loadRollupScopes(
    organizationId: string,
    tier: Exclude<AlertRuntimeTier, 'fast'>,
    limit: number,
  ): Promise<ScopePayload[]> {
    if (tier === 'ai') return this.loadAiScopes(organizationId, limit);
    if (tier === 'operational') return this.loadOperationalScopes(organizationId, limit);
    return this.loadWindowScopes(organizationId, limit);
  }

  private async loadWindowScopes(organizationId: string, limit: number): Promise<ScopePayload[]> {
    const requestResult = await this.logDb.query<Record<string, unknown>>(
      `SELECT organization_id, project_id, environment, bucket,
              total_count, success_count, error_count, auth_failure_count,
              CASE WHEN total_count > 0 THEN 100.0 * error_count / total_count ELSE NULL END AS error_rate,
              CASE WHEN total_count > 0 THEN 100.0 * auth_failure_count / total_count ELSE NULL END AS auth_failure_rate,
              latency_p95_ms, latency_p99_ms,
              CASE WHEN total_count > 0 THEN 100.0 * (total_count - error_count) / total_count ELSE NULL END AS availability_pct
         FROM request_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '5 minutes'
        ORDER BY bucket DESC
        LIMIT $4`,
      [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit],
    );

    const cronResult = await this.logDb.query<Record<string, unknown>>(
      `SELECT organization_id, project_id, environment, entity_key, entity_label, monitor_slug, bucket,
              checkin_count, error_count, missed_count, last_status, duration_p95_ms,
              CASE WHEN checkin_count > 0 THEN 100.0 * (error_count + missed_count) / checkin_count ELSE NULL END AS failure_rate
         FROM cron_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '5 minutes'
        ORDER BY bucket DESC
        LIMIT $4`,
      [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit],
    );

    const aiResult = await this.logDb.query<Record<string, unknown>>(
      `SELECT organization_id, project_id, environment, entity_key, entity_label, bucket,
              request_count, failure_count, latency_p95_ms, latency_p99_ms,
              CASE WHEN request_count > 0 THEN 100.0 * failure_count / request_count ELSE NULL END AS failure_rate
         FROM ai_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '5 minutes'
        ORDER BY bucket DESC
        LIMIT $4`,
      [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit],
    );

    return [
      ...requestResult.rows.map((row) => ({
      scope: {
        organizationId,
        projectId: String(row.project_id),
        environment: typeof row.environment === 'string' ? row.environment : null,
      },
      payload: {
        values: {
          errors: { rate: numberOrNull(row.error_rate) },
          error: { rate: numberOrNull(row.error_rate) },
          requests: {
            count: numberOrNull(row.total_count),
            error_rate: numberOrNull(row.error_rate),
            degraded_rate: numberOrNull(row.error_rate),
            '5xx_rate': numberOrNull(row.error_rate),
            auth_failure: numberOrNull(row.auth_failure_count),
            auth_failure_rate: numberOrNull(row.auth_failure_rate),
            latency: {
              p95: numberOrNull(row.latency_p95_ms),
              p99: numberOrNull(row.latency_p99_ms),
            },
          },
          latency: { p95: numberOrNull(row.latency_p95_ms), p99: numberOrNull(row.latency_p99_ms) },
          availability: { pct: numberOrNull(row.availability_pct) },
        },
        observedAt: row.bucket instanceof Date ? row.bucket : new Date(String(row.bucket)),
        source: 'alert.evaluate.window',
        labels: { rollup: 'request_metrics_1m' },
        evidence: row,
      },
    })),
      ...cronResult.rows.map((row) => ({
        scope: {
          organizationId,
          projectId: String(row.project_id),
          environment: typeof row.environment === 'string' ? row.environment : null,
          service: typeof row.entity_key === 'string' ? row.entity_key : null,
        },
        payload: {
          values: {
            cron: {
              failure_rate: numberOrNull(row.failure_rate),
              failures: numberOrNull(row.error_count),
              missed: numberOrNull(row.missed_count),
              duration: { p95: numberOrNull(row.duration_p95_ms) },
              last_status: row.last_status,
            },
          },
          observedAt: row.bucket instanceof Date ? row.bucket : new Date(String(row.bucket)),
          source: 'alert.evaluate.window',
          labels: { rollup: 'cron_metrics_1m', monitor: row.monitor_slug ?? row.entity_key },
          evidence: row,
        },
      })),
      ...aiResult.rows.map((row) => ({
        scope: {
          organizationId,
          projectId: String(row.project_id),
          environment: typeof row.environment === 'string' ? row.environment : null,
        },
        payload: {
          values: {
            ai: {
              failure_rate: numberOrNull(row.failure_rate),
              duration: { p95: numberOrNull(row.latency_p95_ms) },
              latency: { p95: numberOrNull(row.latency_p95_ms), p99: numberOrNull(row.latency_p99_ms) },
              requests: { count: numberOrNull(row.request_count), failed: numberOrNull(row.failure_count) },
            },
          },
          observedAt: row.bucket instanceof Date ? row.bucket : new Date(String(row.bucket)),
          source: 'alert.evaluate.window',
          labels: { rollup: 'ai_metrics_1m', model: row.entity_key },
          evidence: row,
        },
      })),
    ].slice(0, limit);
  }

  private async loadOperationalScopes(organizationId: string, limit: number): Promise<ScopePayload[]> {
    const runtimeResult = await this.logDb.query<Record<string, unknown>>(
      `SELECT organization_id, project_id, environment, entity_key, entity_label, bucket,
              sample_count, heap_used_mb_avg, heap_used_mb_max, rss_mb_avg, rss_mb_max,
              eventloop_lag_p95_ms, eventloop_lag_p99_ms
         FROM runtime_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '10 minutes'
        ORDER BY bucket DESC
        LIMIT $4`,
      [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit],
    );

    const logResult = await this.logDb.query<Record<string, unknown>>(
      `SELECT organization_id, project_id, environment, bucket,
              total_count, error_count, warn_count,
              CASE WHEN total_count > 0 THEN 100.0 * error_count / total_count ELSE NULL END AS error_rate
         FROM log_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '10 minutes'
        ORDER BY bucket DESC
        LIMIT $4`,
      [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit],
    );

    const serviceResult = await this.logDb.query<Record<string, unknown>>(
      `SELECT organization_id, project_id, environment, entity_key, entity_label, bucket,
              total_count, error_count, availability_pct, health_score, latency_p95_ms
         FROM service_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '10 minutes'
        ORDER BY bucket DESC
        LIMIT $4`,
      [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit],
    );

    const endpointResult = await this.logDb.query<Record<string, unknown>>(
      `SELECT organization_id, project_id, environment, entity_key, entity_label, route, service, bucket,
              total_count, error_count, latency_p95_ms,
              CASE WHEN total_count > 0 THEN 100.0 * (total_count - error_count) / total_count ELSE NULL END AS health_score
         FROM endpoint_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '10 minutes'
        ORDER BY bucket DESC
        LIMIT $4`,
      [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit],
    );

    const metricResult = await this.logDb.query<Record<string, unknown>>(
      `SELECT organization_id, project_id, environment, entity_key, entity_label, service, bucket,
              value_last, value_p95, value_max, point_count
         FROM metric_series_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '10 minutes'
          AND (
            lower(entity_key) LIKE '%cpu%'
            OR lower(entity_key) LIKE '%memory%'
            OR lower(entity_key) LIKE '%disk%'
            OR lower(entity_key) LIKE '%network%error%'
            OR lower(entity_key) LIKE '%queue%backlog%'
            OR lower(entity_key) LIKE '%db%connection%'
          )
        ORDER BY bucket DESC
        LIMIT $4`,
      [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit],
    );

    return [
      ...runtimeResult.rows.map((row) => ({
      scope: {
        organizationId,
        projectId: String(row.project_id),
        environment: typeof row.environment === 'string' ? row.environment : null,
        service: typeof row.entity_key === 'string' ? row.entity_key : null,
      },
      payload: {
        values: {
          runtime: {
            cpu: { usage: null },
            memory: {
              usage: numberOrNull(row.heap_used_mb_avg),
              heap_used_mb_avg: numberOrNull(row.heap_used_mb_avg),
              heap_used_mb_max: numberOrNull(row.heap_used_mb_max),
              rss_mb_avg: numberOrNull(row.rss_mb_avg),
              rss_mb_max: numberOrNull(row.rss_mb_max),
            },
            eventloop: {
              lag_p95_ms: numberOrNull(row.eventloop_lag_p95_ms),
              lag_p99_ms: numberOrNull(row.eventloop_lag_p99_ms),
            },
          },
          metrics: {
            cpu: { usage: null },
            memory: { usage: numberOrNull(row.heap_used_mb_avg) },
          },
          service: { health: numberOrNull(row.sample_count) },
        },
        observedAt: row.bucket instanceof Date ? row.bucket : new Date(String(row.bucket)),
        source: 'alert.evaluate.operational',
        labels: { rollup: 'runtime_metrics_1m', service: row.entity_key },
        evidence: row,
      },
    })),
      ...logResult.rows.map((row) => ({
        scope: {
          organizationId,
          projectId: String(row.project_id),
          environment: typeof row.environment === 'string' ? row.environment : null,
        },
        payload: {
          values: {
            logs: {
              error_count: numberOrNull(row.error_count),
              error_rate: numberOrNull(row.error_rate),
              warn_count: numberOrNull(row.warn_count),
            },
            db: { connection_errors: numberOrNull(row.error_count) },
          },
          observedAt: row.bucket instanceof Date ? row.bucket : new Date(String(row.bucket)),
          source: 'alert.evaluate.operational',
          labels: { rollup: 'log_metrics_1m' },
          evidence: row,
        },
      })),
      ...serviceResult.rows.map((row) => ({
        scope: {
          organizationId,
          projectId: String(row.project_id),
          environment: typeof row.environment === 'string' ? row.environment : null,
          service: typeof row.entity_key === 'string' ? row.entity_key : null,
        },
        payload: {
          values: {
            service: {
              health: numberOrNull(row.health_score) ?? numberOrNull(row.availability_pct),
              availability: numberOrNull(row.availability_pct),
              error_count: numberOrNull(row.error_count),
              latency: { p95: numberOrNull(row.latency_p95_ms) },
            },
          },
          observedAt: row.bucket instanceof Date ? row.bucket : new Date(String(row.bucket)),
          source: 'alert.evaluate.operational',
          labels: { rollup: 'service_metrics_1m', service: row.entity_key },
          evidence: row,
        },
      })),
      ...endpointResult.rows.map((row) => ({
        scope: {
          organizationId,
          projectId: String(row.project_id),
          environment: typeof row.environment === 'string' ? row.environment : null,
          service: typeof row.service === 'string' ? row.service : null,
          endpoint: typeof row.route === 'string' ? row.route : typeof row.entity_key === 'string' ? row.entity_key : null,
        },
        payload: {
          values: {
            endpoint: {
              health: numberOrNull(row.health_score),
              error_count: numberOrNull(row.error_count),
              latency: { p95: numberOrNull(row.latency_p95_ms) },
            },
          },
          observedAt: row.bucket instanceof Date ? row.bucket : new Date(String(row.bucket)),
          source: 'alert.evaluate.operational',
          labels: { rollup: 'endpoint_metrics_1m', endpoint: row.route ?? row.entity_key },
          evidence: row,
        },
      })),
      ...metricResult.rows.map((row) => metricSeriesScope(organizationId, row)),
    ].slice(0, limit);
  }

  private async loadAiScopes(organizationId: string, limit: number): Promise<ScopePayload[]> {
    const result = await this.logDb.query<Record<string, unknown>>(
      `SELECT organization_id, project_id, environment, entity_key, entity_label, bucket,
              request_count, failure_count, credits_consumed, cost_micros,
              latency_p95_ms, latency_p99_ms,
              CASE WHEN request_count > 0 THEN 100.0 * failure_count / request_count ELSE NULL END AS failure_rate
         FROM ai_metrics_1h
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '2 hours'
        ORDER BY bucket DESC
        LIMIT $4`,
      [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit],
    );
    return result.rows.map((row) => ({
      scope: {
        organizationId,
        projectId: String(row.project_id),
        environment: typeof row.environment === 'string' ? row.environment : null,
      },
      payload: {
        values: {
          ai: {
            failure_rate: numberOrNull(row.failure_rate),
            duration: { p95: numberOrNull(row.latency_p95_ms) },
            latency: { p95: numberOrNull(row.latency_p95_ms), p99: numberOrNull(row.latency_p99_ms) },
            cost: { micros: numberOrNull(row.cost_micros), usd: numberOrNull(row.cost_micros) === null ? null : numberOrNull(row.cost_micros)! / 1_000_000 },
            credits: { consumed: numberOrNull(row.credits_consumed), used: numberOrNull(row.credits_consumed) },
            requests: { count: numberOrNull(row.request_count), failed: numberOrNull(row.failure_count) },
          },
        },
        observedAt: row.bucket instanceof Date ? row.bucket : new Date(String(row.bucket)),
        source: 'alert.evaluate.ai',
        labels: { rollup: 'ai_metrics_1h', model: row.entity_key },
        evidence: row,
      },
    }));
  }
}

function fastPayload(scoped: ScopedEvent): RuntimePayload {
  const event = scoped.event;
  const record = event as unknown as Record<string, unknown>;
  const timestamp = new Date(resolveTimestamp(event));
  const values: Record<string, unknown> = {
    telemetry: { type: event.type },
  };

  if (event.type === 'error') {
    const severity = typeof record.severity === 'string' ? record.severity.toLowerCase() : 'error';
    values.errors = {
      unhandled: record.mechanism !== 'handled',
      fatal: severity === 'fatal' || severity === 'critical',
      crash: record.crashed === true || record.event === 'crash',
      message: record.message,
      severity,
    };
  } else if (event.type === 'log') {
    const message = typeof record.message === 'string' ? record.message : '';
    values.logs = {
      oom: /out of memory|heap out of memory|oom/i.test(message),
      security: hasSecuritySignal(record),
      message,
      level: record.level,
    };
  } else if (event.type === 'cron_checkin') {
    values.cron = {
      failed: record.status === 'error',
      status: record.status,
      monitor: record.monitorSlug,
    };
  } else if (event.type === 'request') {
    values.requests = {
      auth_failure: Number(record.statusCode) === 401 || Number(record.statusCode) === 403,
      status_code: record.statusCode,
      latency_ms: record.latency,
    };
  }

  return {
    values,
    observedAt: timestamp,
    source: `telemetry.${event.type}`,
    labels: {
      event_type: event.type,
      project_id: scoped.projectId,
      environment: scoped.environment,
    },
    evidence: {
      projectId: scoped.projectId,
      environment: scoped.environment,
      eventType: event.type,
      event,
    },
  };
}

function fastSignalPayload(organizationId: string, signal: FastSignalInput): RuntimePayload {
  const observedAt = signal.occurredAt instanceof Date
    ? signal.occurredAt
    : signal.occurredAt ? new Date(signal.occurredAt) : new Date();
  const values: Record<string, unknown> = {
    telemetry: { type: signal.source },
  };
  if (signal.source === 'deployment') values.deployment = { failed: signal.kind === 'failed' };
  if (signal.source === 'heartbeat') values.heartbeat = { lost: signal.kind === 'lost' || signal.kind === 'timeout' };
  if (signal.source === 'connector') values.connector = { failure: signal.kind === 'open_circuit' || signal.kind === 'failure' };
  if (signal.source === 'security') values.logs = { security: true };
  return {
    values,
    observedAt,
    source: `${signal.source}.${signal.kind}`,
    labels: {
      organization_id: organizationId,
      project_id: signal.projectId ?? null,
      environment: signal.environment ?? null,
      ...signal.labels,
    },
    evidence: signal.evidence ?? {},
  };
}

function categoryForRule(conditions: AlertRuleConditionRow[], source: string): string {
  const fieldPath = conditions[0]?.field_path?.toLowerCase() ?? '';
  if (fieldPath.startsWith('security') || fieldPath.includes('auth')) return 'security';
  if (fieldPath.startsWith('deployment')) return 'deployment';
  if (fieldPath.startsWith('cron')) return 'cron';
  if (fieldPath.startsWith('ai.')) return 'ai';
  if (fieldPath.includes('latency') || fieldPath.includes('availability') || fieldPath.includes('error')) return 'performance';
  if (source.includes('billing')) return 'billing';
  return 'all';
}

function firstObservedValue(results: Array<{ actual: unknown; passed: boolean }>): number | null {
  for (const result of results) {
    const value = numberOrNull(result.actual);
    if (value !== null) return value;
  }
  return null;
}

function firstThresholdValue(conditions: AlertRuleConditionRow[]): number | null {
  for (const condition of conditions) {
    const value = numberOrNull(condition.threshold_value);
    if (value !== null) return value;
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function hasSecuritySignal(record: Record<string, unknown>): boolean {
  const tags = record.tags;
  const message = typeof record.message === 'string' ? record.message : '';
  return /security|csrf|xss|sql injection|auth bypass/i.test(message)
    || (typeof tags === 'object' && tags !== null && Object.values(tags).some((value) =>
      typeof value === 'string' && /security|critical/i.test(value),
    ));
}

function metricSeriesScope(organizationId: string, row: Record<string, unknown>): ScopePayload {
  const metric = typeof row.entity_key === 'string' ? row.entity_key.toLowerCase() : '';
  const value = numberOrNull(row.value_p95) ?? numberOrNull(row.value_last) ?? numberOrNull(row.value_max);
  const values: Record<string, unknown> = { metrics: {}, runtime: {}, queue: {}, db: {} };
  const metrics = values.metrics as Record<string, unknown>;
  const runtime = values.runtime as Record<string, unknown>;
  const queue = values.queue as Record<string, unknown>;
  const db = values.db as Record<string, unknown>;

  if (metric.includes('cpu')) {
    metrics.cpu = { usage: value };
    runtime.cpu = { usage: value };
  }
  if (metric.includes('memory') || metric.includes('mem')) {
    metrics.memory = { usage: value };
    runtime.memory = { usage: value };
  }
  if (metric.includes('disk')) {
    runtime.disk = { usage: value };
  }
  if (metric.includes('network') && metric.includes('error')) {
    runtime.network_errors = value;
  }
  if (metric.includes('queue') && metric.includes('backlog')) {
    queue.backlog = value;
  }
  if (metric.includes('db') && metric.includes('connection')) {
    db.connection_errors = value;
  }

  return {
    scope: {
      organizationId,
      projectId: String(row.project_id),
      environment: typeof row.environment === 'string' ? row.environment : null,
      service: typeof row.service === 'string' ? row.service : null,
    },
    payload: {
      values,
      observedAt: row.bucket instanceof Date ? row.bucket : new Date(String(row.bucket)),
      source: 'alert.evaluate.operational',
      labels: { rollup: 'metric_series_1m', metric: row.entity_key },
      evidence: row,
    },
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function emptySummary(): RuntimeEvaluationSummary {
  return {
    scopes: 0,
    rules: 0,
    evaluated: 0,
    fired: 0,
    recovered: 0,
    suppressed: 0,
    skipped: 0,
    failed: 0,
  };
}
