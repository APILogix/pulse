import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { pgboss } from '../../../lib/pgboss.js';
import { evaluateCondition, evaluateRule, readPath, type EvaluableCondition } from '../evaluator.js';
import type { AlertRuleConditionRow } from '../rules/rules.types.js';
import type { EffectiveRule, EvaluationScope } from '../policy/resolve-rule.js';
import { AlertRuntimeRepository, type AlertEngine } from './alert-runtime.repository.js';
import { AlertRuntimeRuleCatalog, type AlertRuntimeTier, type RuntimeRuleRow } from './rule-catalog.js';
import { AlertChannelRepository } from '../../projects/alerts/channels/channel.repository.js';
import { AlertConfigRepository } from '../config/alert-config.repository.js';
import { NotificationRoutingService } from './notification-routing.service.js';
import { AlertDecisionEngine, alertFingerprint } from '../decision/decision.engine.js';
import { AlertRedisStateService } from './alert-redis-state.js';
import { computeAlertFingerprint } from './alert-fingerprint.js';
import { IncidentsRepository } from '../incidents/incidents.repository.js';
import {
  recordAlertRecovered,
  recordAlertTriggered,
  recordCooldownBlocked,
  recordEvaluated,
  recordEvaluationFailed,
  recordEvaluationLatency,
  recordEvaluationMatched,
  recordEvaluationSkipped,
  recordEvaluationStale,
} from './alert-runtime-metrics.js';
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
  /** Scopes skipped because their source rollup was too stale to trust. */
  stale: number;
}

/**
 * Maximum age of a rollup bucket that may still drive an alert decision, per
 * tier, in seconds.
 *
 * DERIVATION (not arbitrary): window/operational tiers read `*_metrics_1m`
 * tables, whose bucket granularity is 60s, so a healthy pipeline produces a new
 * bucket every minute. The AI tier reads `ai_metrics_1h` (3600s granularity).
 * The allowance is a small multiple of the tier's own bucket granularity, sized
 * to tolerate normal rollup-worker lag without accepting genuinely stale data:
 *
 *   window      = 3 x 60s   = 180s   (poll cadence 5s; 2 buckets of lag headroom)
 *   operational = 5 x 60s   = 300s   (poll cadence 30s; coarser, more headroom)
 *   ai          = 2 x 3600s = 7200s  (matches the tier's existing 2h SQL lookback)
 *
 * Beyond this the analytics pipeline is lagging or stalled, so the rollup no
 * longer represents "now". Firing on it would be a false positive, and treating
 * it as healthy would mask a blind monitoring system - so we skip the decision
 * and surface it via `alert_evaluation_stale_total`.
 */
const ROLLUP_MAX_STALENESS_SECONDS: Record<string, number> = {
  window: 180,
  operational: 300,
  ai: 7200,
};

export interface RuntimePayload {
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
  private readonly redisState: AlertRedisStateService;
  private readonly log: FastifyBaseLogger;
  private readonly workerId: string;

  constructor(
    logger: FastifyBaseLogger,
    private readonly logDb: Pool,
    private readonly controlDb: Pool,
    routing?: NotificationRoutingService,
    redisState?: AlertRedisStateService,
    catalog?: AlertRuntimeRuleCatalog,
  ) {
    this.catalog = catalog ?? new AlertRuntimeRuleCatalog(controlDb);
    this.runtime = new AlertRuntimeRepository(logDb);
    this.decision = new AlertDecisionEngine(logDb, logger, {
      routing: routing ?? new NotificationRoutingService({
        logger,
        channelRepository: new AlertChannelRepository(controlDb),
        configRepository: new AlertConfigRepository(controlDb),
      }),
      // Incidents are control-plane state, so they use the control/primary pool.
      // This engine only ever runs in a worker process, so incident writes are
      // structurally off the ingestion request path.
      incidents: new IncidentsRepository(controlDb),
    });
    this.redisState = redisState ?? new AlertRedisStateService({ logger });
    this.log = logger.child({ component: 'alert-runtime-engines' });
    this.workerId = `worker_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async evaluateFast(input: FastEvaluationInput): Promise<RuntimeEvaluationSummary> {
    const startedAt = Date.now();
    const summary = emptySummary();
    const snapshot = await this.catalog.loadCatalogSnapshot(input.organizationId, 'fast');
    const scope: EvaluationScope = {
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      environment: input.environment ?? null,
    };
    const resolved = snapshot.resolveRulesForScope(scope);
    summary.scopes = 1;
    summary.rules = resolved.length;

    // Rule-level detail is per-event on the fast path: keep it at debug and
    // structured. Never console.log here.
    this.log.debug(
      {
        tier: 'fast',
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        matchedRuleIds: resolved.map((r) => r.rule.id),
        catalogRulesTotal: snapshot.rules.length,
      },
      resolved.length > 0
        ? 'fast tier resolved candidate rules for scope'
        : 'fast tier resolved no candidate rules for scope',
    );

    this.log.info(
      {
        phase: '3_alert_check_started',
        tier: 'fast',
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        environment: input.environment ?? null,
        eventCount: (input.events ?? []).length + (input.signals ?? []).length,
        rulesToEvaluate: resolved.length,
        catalogRulesTotal: snapshot.rules.length,
      },
      '[Phase 3/4] Moving to alert rules checking',
    );

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
        : snapshot.resolveRulesForScope(signalScope);
      const payload = fastSignalPayload(input.organizationId, signal);
      for (const candidate of signalRules) {
        await this.evaluateCandidate(candidate.rule, candidate.effective, signalScope, payload, 'fast', summary);
      }
    }

    recordEvaluationLatency('fast', Date.now() - startedAt);

    this.log.info(
      {
        phase: '4_alert_check_complete',
        tier: 'fast',
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        rulesEvaluated: summary.evaluated,
        fired: summary.fired,
        recovered: summary.recovered,
        suppressed: summary.suppressed,
        durationMs: Date.now() - startedAt,
      },
      '[Phase 4/4] Alert rules check complete',
    );

    return summary;
  }

  async evaluateTier(input: TierEvaluationInput): Promise<RuntimeEvaluationSummary> {
    const startedAt = Date.now();
    const summary = emptySummary();
    const scopes = await this.loadRollupScopes(input.organizationId, input.tier, input.maxScopes ?? DEFAULT_MAX_SCOPES);
    summary.scopes = scopes.length;
    if (scopes.length === 0) return summary;

    // Load organization rule catalog snapshot once per tick (3 queries total instead of 3 * N)
    const snapshot = await this.catalog.loadCatalogSnapshot(input.organizationId, input.tier);

    this.log.info(
      {
        phase: '3_alert_check_started',
        tier: input.tier,
        organizationId: input.organizationId,
        scopesCount: scopes.length,
        catalogRulesTotal: snapshot.rules.length,
      },
      '[Phase 3/4] Moving to alert rules checking',
    );

    const maxStalenessSeconds = ROLLUP_MAX_STALENESS_SECONDS[input.tier] ?? 300;
    const evaluationStartedAt = Date.now();

    for (const scopePayload of scopes) {
      // ── Rollup freshness gate ───────────────────────────────────────────────
      // Rollup-driven tiers evaluate a pre-aggregated bucket produced by the
      // independent analytics pipeline. If that pipeline lags or stalls, the
      // bucket no longer represents current state. Deciding on it would either
      // fire a false positive or silently report "healthy" while blind, so we
      // refuse the decision and make the staleness observable instead.
      const bucketAgeSeconds = (evaluationStartedAt - scopePayload.payload.observedAt.getTime()) / 1000;
      if (bucketAgeSeconds > maxStalenessSeconds) {
        summary.stale += 1;
        recordEvaluationStale(input.tier);
        this.log.warn(
          {
            tier: input.tier,
            organizationId: input.organizationId,
            projectId: scopePayload.scope.projectId ?? null,
            environment: scopePayload.scope.environment ?? null,
            bucketAgeSeconds: Math.round(bucketAgeSeconds),
            maxStalenessSeconds,
            observedAt: scopePayload.payload.observedAt.toISOString(),
          },
          'alert evaluation skipped: source rollup is stale (analytics pipeline may be lagging)',
        );
        continue;
      }

      // In-memory pure resolution of effective rules and bindings (Zero Control DB queries)
      const resolved = snapshot.resolveRulesForScope(scopePayload.scope);
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

    recordEvaluationLatency(input.tier, Date.now() - startedAt);

    this.log.info(
      {
        phase: '4_alert_check_complete',
        tier: input.tier,
        organizationId: input.organizationId,
        rulesEvaluated: summary.evaluated,
        fired: summary.fired,
        recovered: summary.recovered,
        suppressed: summary.suppressed,
        stale: summary.stale,
        durationMs: Date.now() - startedAt,
      },
      '[Phase 4/4] Alert rules check complete',
    );

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

      // If the telemetry payload does not contain ANY metrics for this rule's domain, skip it
      const hasRelevantMetrics = evaluable.some((c) => {
        if (c.operator === 'exists') return true;
        const val = readPath(payload.values, c.fieldPath);
        return val !== undefined && val !== null;
      });

      if (!hasRelevantMetrics) {
        // Payload belongs to a different domain (e.g. evaluating CPU rules on a
        // Log payload). Previously this returned silently with no counter, making
        // "rule never evaluated" indistinguishable from "rule evaluated false".
        recordEvaluationSkipped(engine, 'no_relevant_metrics');
        summary.skipped += 1;
        return;
      }

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
      const now = payload.observedAt;
      summary.evaluated += 1;
      recordEvaluated(engine);
      if (result.matched) recordEvaluationMatched(engine);

      // Per-condition detail is high-volume (fires on every candidate on the fast
      // path). Keep it structured and at trace/debug level only - never a raw
      // console.log of the full telemetry payload.
      this.log.trace(
        {
          ruleId: rule.id,
          engine,
          matched: result.matched,
          conditions: result.conditionResults.map((res) => ({
            fieldPath: res.fieldPath,
            operator: res.operator,
            passed: res.passed,
          })),
        },
        'alert condition evaluation detail',
      );

      // Canonical alert identity MUST be computed before the matched/unmatched
      // branch: a fire and its later recovery have to resolve to the SAME
      // alertKey, otherwise a grouped alert fires under one key and "recovers"
      // under another, leaving the original alert firing forever.
      const ruleMetadata = (rule.metadata ?? {}) as Record<string, unknown>;
      const ruleLabels = (rule.labels ?? {}) as Record<string, unknown>;
      const groupBy = (ruleMetadata.groupBy ?? ruleMetadata.group_by ?? ruleLabels.groupBy ?? ruleLabels.group_by ?? null) as string[] | null;
      const { fingerprint: alertKey, dimensionKey, normalizedDimensions } = computeAlertFingerprint({
        organizationId: rule.organization_id,
        projectId: scope.projectId ?? null,
        environment: scope.environment ?? null,
        ruleId: rule.id,
        policyId: `${rule.organization_id}:${rule.id}:${rule.current_revision}`,
        groupBy,
        groupingKeyTemplate: rule.grouping_key_template,
        groupingEnabled: rule.grouping_enabled,
        scope,
        payload,
        severity: effective.severity,
      });

      if (!result.matched) {
        // Atomic recovery claim: exactly one concurrent evaluation observes the
        // breaching -> healthy edge, so only one recovery alert is emitted.
        const { recovered } = await this.runtime.claimRecovery({
          scopeHash,
          organizationId: rule.organization_id,
          ruleId: rule.id,
          bindingId: effective.bindingId,
          projectId: scope.projectId ?? null,
          environment: scope.environment ?? null,
          service: scope.service ?? null,
          endpoint: scope.endpoint ?? null,
          evaluatedAt: now,
        });
        if (recovered) {
          this.log.info(
            { ruleId: rule.id, organizationId: rule.organization_id, engine, observed, threshold },
            'alert recovered',
          );
          recordAlertRecovered(engine);
          // Same canonical alertKey as the fire, so the recovery resolves the
          // alert it is actually recovering.
          await this.appendDecision(
            rule,
            effective,
            scope,
            payload,
            engine,
            'recovered',
            observed,
            threshold,
            normalizedDimensions.route ?? scope.endpoint ?? null,
            normalizedDimensions.service ?? scope.service ?? null,
            dimensionKey !== 'global' ? dimensionKey : null,
            alertKey,
          );
          summary.recovered += 1;
        }
        return;
      }

      // ── Fire gate ────────────────────────────────────────────────────────────
      // Redis is a best-effort FAST-PATH FILTER ONLY. It may cheaply tell us
      // "definitely still cooling down" so we can skip the DB round trip, but it
      // is NEVER the correctness boundary: a Redis outage (or a Redis false
      // "acquired") cannot cause a duplicate alert, because the authoritative
      // decision below is a single atomic DB statement.
      if (effective.cooldownSeconds > 0) {
        const cooldownProbe = await this.redisState.acquireCooldown({
          organizationId: rule.organization_id,
          projectId: scope.projectId ?? null,
          ruleId: rule.id,
          fingerprint: alertKey,
          cooldownSeconds: effective.cooldownSeconds,
          workerId: this.workerId,
          tier: engine,
        });
        // Only a definitive "already held" (not a fallback/degraded result) is
        // allowed to short-circuit, and even then the DB row still records the
        // evaluation so breach counting stays accurate.
        if (!cooldownProbe.acquired && !cooldownProbe.fallback) {
          // Still record the breach atomically so consecutive counting stays
          // correct while we skip the fire decision. cooldownSeconds is passed
          // as 0 here only to advance the counter; `fired` is ignored.
          await this.runtime.claimBreachDecision({
            scopeHash,
            organizationId: rule.organization_id,
            ruleId: rule.id,
            bindingId: effective.bindingId,
            projectId: scope.projectId ?? null,
            environment: scope.environment ?? null,
            service: scope.service ?? null,
            endpoint: scope.endpoint ?? null,
            evaluatedAt: now,
            requiredBreaches: Number.MAX_SAFE_INTEGER,
            cooldownSeconds: effective.cooldownSeconds,
          });
          recordCooldownBlocked(engine, 'redis-fastpath');
          this.log.debug(
            { ruleId: rule.id, organizationId: rule.organization_id, engine, dimensionKey, gate: 'redis-fastpath' },
            'alert suppressed: cooldown active',
          );
          summary.suppressed += 1;
          return;
        }
      }

      // AUTHORITATIVE gate: atomic breach increment + cooldown claim in one
      // statement. Exactly one concurrent evaluation can receive fired=true.
      const decision = await this.runtime.claimBreachDecision({
        scopeHash,
        organizationId: rule.organization_id,
        ruleId: rule.id,
        bindingId: effective.bindingId,
        projectId: scope.projectId ?? null,
        environment: scope.environment ?? null,
        service: scope.service ?? null,
        endpoint: scope.endpoint ?? null,
        evaluatedAt: now,
        requiredBreaches: effective.consecutiveBreaches,
        cooldownSeconds: effective.cooldownSeconds,
      });

      const consecutive = decision.consecutiveBreaches;
      const shouldFire = consecutive >= effective.consecutiveBreaches;
      const inCooldown = !decision.fired;

      this.log.debug(
        {
          ruleId: rule.id,
          organizationId: rule.organization_id,
          projectId: scope.projectId ?? null,
          engine,
          observed,
          threshold,
          consecutive,
          requiredBreaches: effective.consecutiveBreaches,
          shouldFire,
          inCooldown,
          dimensionKey,
        },
        'alert rule matched condition',
      );

      // NOTE: no further state write here. `claimBreachDecision` above is the
      // single authoritative writer for consecutive_breaches/last_fired_at.
      // Writing again would reintroduce the lost-update race it exists to remove.

      if (decision.indeterminate) {
        // Fail closed and make it visible rather than firing on unknown state.
        this.log.error(
          { ruleId: rule.id, organizationId: rule.organization_id, engine, scopeHash },
          'alert fire gate indeterminate: evaluation state row missing, refusing to fire',
        );
        recordEvaluationFailed(engine, 'indeterminate_state');
        summary.failed += 1;
        return;
      }
      if (!shouldFire) {
        this.log.debug(
          { ruleId: rule.id, engine, consecutive, requiredBreaches: effective.consecutiveBreaches },
          'alert suppressed: awaiting consecutive breaches',
        );
        summary.suppressed += 1;
        return;
      }
      if (inCooldown) {
        recordCooldownBlocked(engine, 'db-authoritative');
        this.log.debug(
          { ruleId: rule.id, engine, cooldownSeconds: effective.cooldownSeconds, dimensionKey, gate: 'db-authoritative' },
          'alert suppressed: cooldown active',
        );
        summary.suppressed += 1;
        return;
      }

      this.log.info(
        {
          ruleId: rule.id,
          organizationId: rule.organization_id,
          projectId: scope.projectId ?? null,
          engine,
          observed,
          threshold,
          dimensionKey,
        },
        'alert fired',
      );
      await this.appendDecision(
        rule,
        effective,
        scope,
        payload,
        engine,
        'fired',
        observed,
        threshold,
        normalizedDimensions.route ?? scope.endpoint ?? null,
        normalizedDimensions.service ?? scope.service ?? null,
        dimensionKey !== 'global' ? dimensionKey : null,
        alertKey,
      );
      recordAlertTriggered(engine);
      summary.fired += 1;
    } catch (err) {
      summary.failed += 1;
      recordEvaluationFailed(engine, 'exception');
      this.log.error(
        { err, ruleId: rule.id, organizationId: rule.organization_id, engine },
        'Runtime alert evaluation failed',
      );
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
    endpointOverride?: string | null,
    serviceOverride?: string | null,
    dimensionOverride?: string | null,
    canonicalAlertKey?: string,
  ): Promise<void> {
    const effectiveProjectRule = buildEffectiveProjectRule(rule, effective, scope);
    if (!effectiveProjectRule) {
      // Fail loudly: a missing effective project rule means we cannot establish
      // rule identity, so the decision is dropped. This must be observable.
      recordEvaluationFailed(engine, 'no_effective_project_rule');
      this.log.error(
        { ruleId: rule.id, organizationId: rule.organization_id, projectId: scope.projectId ?? null, engine },
        'alert decision skipped: could not build effective project rule',
      );
      return;
    }
    const result = await this.decision.decide({
      // Pass the canonical identity so the cooldown key and the durable
      // dedup/state key are guaranteed identical (single fingerprint contract).
      ...(canonicalAlertKey ? { alertKey: canonicalAlertKey } : {}),
      organizationId: rule.organization_id,
      projectId: scope.projectId ?? null,
      environment: scope.environment ?? null,
      service: serviceOverride ?? scope.service ?? null,
      endpoint: endpointOverride ?? scope.endpoint ?? null,
      dimension: dimensionOverride ?? null,
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
      evidence: {
        ...payload.evidence,
        labels: payload.labels,
        values: payload.values,
        observedValue: observed,
        thresholdValue: threshold,
      },
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
    if (result.notificationJobs.length > 0) {
      this.log.info(
        {
          alertKey: result.alertKey,
          ruleId: rule.id,
          organizationId: rule.organization_id,
          projectId: scope.projectId ?? null,
          notificationJobs: result.notificationJobs.length,
        },
        'alert queued',
      );
    }
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
              total_count, success_count, error_count, slow_count, auth_failure_count,
              CASE WHEN total_count > 0 THEN 100.0 * error_count / total_count ELSE NULL END AS error_rate,
              CASE WHEN total_count > 0 THEN 100.0 * (error_count + slow_count) / total_count ELSE NULL END AS degraded_rate,
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
            degraded_rate: numberOrNull(row.degraded_rate),
            '5xx_rate': numberOrNull(row.error_rate),
            auth_failure: numberOrNull(row.auth_failure_count),
            auth_failure_rate: numberOrNull(row.auth_failure_rate),
            latency: {
              p95: numberOrNull(row.latency_p95_ms),
              p99: numberOrNull(row.latency_p99_ms),
              ms: numberOrNull(row.latency_p95_ms),
              value: numberOrNull(row.latency_p95_ms),
            },
            latency_ms: numberOrNull(row.latency_p95_ms),
            duration_ms: numberOrNull(row.latency_p95_ms),
            duration: numberOrNull(row.latency_p95_ms),
          },
          latency: {
            p95: numberOrNull(row.latency_p95_ms),
            p99: numberOrNull(row.latency_p99_ms),
            ms: numberOrNull(row.latency_p95_ms),
            value: numberOrNull(row.latency_p95_ms),
          },
          latency_ms: numberOrNull(row.latency_p95_ms),
          duration_ms: numberOrNull(row.latency_p95_ms),
          duration: numberOrNull(row.latency_p95_ms),
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
            // Note on CPU metric provenance:
            // Node.js V8 runtime rollups (runtime_metrics_1m) measure internal heap memory and event-loop lag.
            // Host/process OS CPU usage metrics are ingested via custom telemetry and resolved through
            // metric_series_1m (see metricSeriesScope below).
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

function fastPayload(scoped: ScopedEvent | Record<string, unknown>): RuntimePayload {
  const event = ((scoped as ScopedEvent).event ?? scoped) as Record<string, unknown>;
  const record = (event.record ?? event.data ?? event) as Record<string, unknown>;
  let timestamp = new Date();
  try {
    const rawTs = resolveTimestamp(event as never);
    if (rawTs) timestamp = new Date(rawTs);
  } catch {
    const rawTs = event.timestamp ?? (scoped as Record<string, unknown>).timestamp;
    timestamp = rawTs instanceof Date ? rawTs : rawTs ? new Date(rawTs as string | number) : new Date();
  }
  const eventType = String(event.type ?? record.type ?? 'unknown');
  const values: Record<string, unknown> = {
    telemetry: { type: eventType },
  };

  if (event.type === 'error') {
    const severity = typeof record.severity === 'string' ? record.severity.toLowerCase() : 'error';
    const classification = (record.classification ?? {}) as Record<string, unknown>;
    const mechanism = String(record.mechanism ?? '');
    const message = String(record.message ?? '');
    const isUnhandled = classification.unhandled === true || record.handled === false || mechanism === 'uncaughtException' || mechanism === 'unhandledRejection' || record.mechanism !== 'handled';
    const isFatal = severity === 'fatal' || severity === 'critical' || classification.fatal === true;
    const isCrash = classification.crash === true || record.crashed === true || mechanism === 'uncaughtException';
    const isRejection = mechanism === 'unhandledRejection';
    const isDeadlock = /deadlock detected|Lock wait timeout/i.test(message);
    const isConnectorFailure = /CircuitBreakerOpen/i.test(message);

    values.errors = {
      unhandled: isUnhandled,
      fatal: isFatal,
      crash: isCrash,
      rejection: isRejection,
      message,
      severity,
    };
    if (isDeadlock) {
      values.db = { deadlock: true };
    }
    if (isConnectorFailure) {
      values.connector = { failure: true };
    }
  } else if (event.type === 'log') {
    const message = typeof record.message === 'string' ? record.message : '';
    const isOom = /out of memory|heap out of memory|oom/i.test(message);
    const isSecurity = hasSecuritySignal(record);
    const isDeadlock = /deadlock detected|Lock wait timeout/i.test(message);
    values.logs = {
      oom: isOom,
      security: isSecurity,
      deadlock: isDeadlock,
      matches: message,
      message,
      level: record.level,
    };
    if (isDeadlock) {
      values.db = { deadlock: true };
    }
  } else if (event.type === 'cron_checkin') {
    values.cron = {
      failed: record.status === 'error',
      status: record.status,
      monitor: record.monitorSlug,
    };
  } else if (event.type === 'request') {
    const rawLatency = record.latency ?? record.latencyMs ?? record.latency_ms ?? record.durationMs ?? record.duration_ms ?? record.duration ?? record.responseTime ?? record.response_time;
    const duration = numberOrNull(rawLatency);
    const statusCode = numberOrNull(record.statusCode ?? record.status_code);
    const isSlow = duration !== null && duration >= 10000;
    const isAuthFailure = statusCode === 401 || statusCode === 403;
    const isError = statusCode !== null && statusCode >= 500;
    values.requests = {
      auth_failure: isAuthFailure,
      status_code: statusCode,
      latency_ms: duration,
      latency: {
        p95: duration,
        p99: duration,
        ms: duration,
        value: duration,
      },
      latency_p95: duration,
      latency_p99: duration,
      duration_ms: duration,
      duration: duration,
      slow: isSlow,
      error: isError,
    };
    values.latency = {
      p95: duration,
      p99: duration,
      ms: duration,
      value: duration,
    };
    values.latency_ms = duration;
    values.duration = duration;
    values.duration_ms = duration;
  } else if (event.type === 'span') {
    const rawDuration = record.duration ?? record.durationMs ?? (record.endTime && record.startTime ? Number(record.endTime) - Number(record.startTime) : null);
    const duration = numberOrNull(rawDuration);
    const attrs = (record.attributes ?? {}) as Record<string, unknown>;
    const events = (record.events ?? []) as Array<{ name?: string }>;
    const isTimeout = attrs['pulse.timeout'] === true || events.some((e) => e.name === 'pulse.span.timeout');
    const isSlowDb = attrs['db.system'] != null && duration !== null && duration >= 1000;
    const statusCode = numberOrNull(attrs['http.status_code']);
    const isUpstreamOutage = record.kind === 'client' && statusCode !== null && [502, 503, 504].includes(statusCode);
    values.span = {
      duration,
      timeout: isTimeout,
      slow_db: isSlowDb,
      upstream_outage: isUpstreamOutage,
      status: record.status,
    };
  } else if (event.type === 'metric') {
    const metricName = String(record.metricName ?? record.name ?? '');
    const metricVal = numberOrNull(record.value);
    values.metrics = {
      name: metricName,
      value: metricVal,
    };
    if (metricName.includes('eventloop.lag') || metricName.includes('event_loop')) {
      values.eventloop = { lag: metricVal };
    }
    if (metricName === 'pulse.sdk.drops' || metricName.includes('telemetry.drop')) {
      values.telemetry = { drops: metricVal };
    }
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
      projectSlug: (scoped as ScopedEvent).projectSlug,
      projectName: (scoped as ScopedEvent).projectName,
      orgSlug: (scoped as ScopedEvent).orgSlug,
      orgName: (scoped as ScopedEvent).orgName,
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
    stale: 0,
  };
}
