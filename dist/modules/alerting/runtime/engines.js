import { createHash } from 'node:crypto';
import { pgboss } from '../../../lib/pgboss.js';
import { evaluateCondition, evaluateRule, readPath } from '../evaluator.js';
import { AlertRuntimeRepository } from './alert-runtime.repository.js';
import { AlertRuntimeRuleCatalog } from './rule-catalog.js';
import { AlertChannelRepository } from '../../projects/alerts/channels/channel.repository.js';
import { AlertConfigRepository } from '../config/alert-config.repository.js';
import { NotificationRoutingService } from './notification-routing.service.js';
import { AlertDecisionEngine } from '../decision/decision.engine.js';
import { resolveAllEffectiveThresholds } from '../policy/resolve-threshold.js';
import { buildEffectiveProjectRule } from './effective-rule-contract.js';
import { resolveTimestamp } from '../../ingestion/pipeline/event-normalizer.js';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const ALL_ENVIRONMENTS = '__all__';
const DEFAULT_MAX_SCOPES = 500;
export class AlertRuntimeEngines {
    logDb;
    controlDb;
    catalog;
    runtime;
    decision;
    log;
    constructor(logger, logDb, controlDb, routing) {
        this.logDb = logDb;
        this.controlDb = controlDb;
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
    async evaluateFast(input) {
        const startedAt = Date.now();
        const summary = emptySummary();
        const snapshot = await this.catalog.loadCatalogSnapshot(input.organizationId, 'fast');
        const scope = {
            organizationId: input.organizationId,
            projectId: input.projectId ?? null,
            environment: input.environment ?? null,
        };
        const resolved = snapshot.resolveRulesForScope(scope);
        summary.scopes = 1;
        summary.rules = resolved.length;
        console.log(`[ALERTING] 🚀 Moving to alert rules checking (fast tier) | Org: ${input.organizationId} | Project: ${input.projectId ?? 'all'} | Events: ${(input.events ?? []).length + (input.signals ?? []).length} | Rules Found: ${resolved.length}`);
        if (resolved.length > 0) {
            console.log(`[ALERTING] 📋 Alert rules found for scope:`, resolved.map((r) => ({ id: r.rule.id, name: r.rule.name, severity: r.effective.severity, enabled: r.effective.enabled, conditionCount: r.effective.conditions.length })));
        }
        else {
            console.log(`[ALERTING] ⚠️ No active alert rules matched scope for Org: ${input.organizationId}, Project: ${input.projectId ?? 'all'} (Total in Catalog for tier: ${snapshot.rules.length})`);
        }
        this.log.info({
            phase: '3_alert_check_started',
            tier: 'fast',
            organizationId: input.organizationId,
            projectId: input.projectId ?? null,
            environment: input.environment ?? null,
            eventCount: (input.events ?? []).length + (input.signals ?? []).length,
            rulesToEvaluate: resolved.length,
            catalogRulesTotal: snapshot.rules.length,
        }, '[Phase 3/4] Moving to alert rules checking');
        for (const scoped of input.events ?? []) {
            const payload = fastPayload(scoped);
            for (const candidate of resolved) {
                await this.evaluateCandidate(candidate.rule, candidate.effective, scope, payload, 'fast', summary);
            }
        }
        for (const signal of input.signals ?? []) {
            const signalScope = {
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
        console.log(`[ALERTING] ✅ Alert rules check complete (fast tier) | Evaluated: ${summary.evaluated} | Fired: ${summary.fired} | Recovered: ${summary.recovered} | Suppressed: ${summary.suppressed} | Duration: ${Date.now() - startedAt}ms`);
        this.log.info({
            phase: '4_alert_check_complete',
            tier: 'fast',
            organizationId: input.organizationId,
            projectId: input.projectId ?? null,
            rulesEvaluated: summary.evaluated,
            fired: summary.fired,
            recovered: summary.recovered,
            suppressed: summary.suppressed,
            durationMs: Date.now() - startedAt,
        }, '[Phase 4/4] Alert rules check complete');
        return summary;
    }
    async evaluateTier(input) {
        const startedAt = Date.now();
        const summary = emptySummary();
        const scopes = await this.loadRollupScopes(input.organizationId, input.tier, input.maxScopes ?? DEFAULT_MAX_SCOPES);
        summary.scopes = scopes.length;
        if (scopes.length === 0)
            return summary;
        // Load organization rule catalog snapshot once per tick (3 queries total instead of 3 * N)
        const snapshot = await this.catalog.loadCatalogSnapshot(input.organizationId, input.tier);
        console.log(`[ALERTING] 🚀 Moving to alert rules checking (${input.tier} tier) | Org: ${input.organizationId} | Scopes: ${scopes.length} | Catalog Rules: ${snapshot.rules.length}`);
        this.log.info({
            phase: '3_alert_check_started',
            tier: input.tier,
            organizationId: input.organizationId,
            scopesCount: scopes.length,
            catalogRulesTotal: snapshot.rules.length,
        }, '[Phase 3/4] Moving to alert rules checking');
        for (const scopePayload of scopes) {
            // In-memory pure resolution of effective rules and bindings (Zero Control DB queries)
            const resolved = snapshot.resolveRulesForScope(scopePayload.scope);
            summary.rules += resolved.length;
            for (const candidate of resolved) {
                await this.evaluateCandidate(candidate.rule, candidate.effective, scopePayload.scope, scopePayload.payload, input.tier === 'ai' ? 'reconcile' : 'window', summary);
            }
        }
        console.log(`[ALERTING] ✅ Alert rules check complete (${input.tier} tier) | Evaluated: ${summary.evaluated} | Fired: ${summary.fired} | Recovered: ${summary.recovered} | Suppressed: ${summary.suppressed} | Duration: ${Date.now() - startedAt}ms`);
        this.log.info({
            phase: '4_alert_check_complete',
            tier: input.tier,
            organizationId: input.organizationId,
            rulesEvaluated: summary.evaluated,
            fired: summary.fired,
            recovered: summary.recovered,
            suppressed: summary.suppressed,
            durationMs: Date.now() - startedAt,
        }, '[Phase 4/4] Alert rules check complete');
        return summary;
    }
    async evaluateCandidate(rule, effective, scope, payload, engine, summary) {
        if (!effective.enabled || effective.conditions.length === 0) {
            summary.skipped += 1;
            return;
        }
        try {
            const evaluable = effective.conditions.map((condition) => ({
                id: condition.id,
                conditionGroupId: condition.condition_group_id,
                fieldPath: condition.field_path,
                operator: condition.operator,
                thresholdValue: condition.threshold_value,
                isRequired: condition.is_required,
            }));
            // If the telemetry payload does not contain ANY metrics for this rule's domain, skip it
            const hasRelevantMetrics = evaluable.some((c) => {
                if (c.operator === 'exists')
                    return true;
                const val = readPath(payload.values, c.fieldPath);
                return val !== undefined && val !== null;
            });
            if (!hasRelevantMetrics) {
                // Payload belongs to a different domain (e.g. evaluating CPU rules on a Log payload)
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
            const states = await this.runtime.getRuleEvalStates([scopeHash]);
            const previous = states[0] ?? null;
            const now = payload.observedAt;
            summary.evaluated += 1;
            console.log(`\n[ALERTING] [Phase 2/4: Candidate Evaluation] Rule: "${rule.name}" (${rule.id}) | Scope: [Project: ${scope.projectId ?? 'all'}, Env: ${scope.environment ?? 'all'}] | Tier: ${engine}`);
            console.log(`[ALERTING] [Phase 3/4: Payload Inspection] Payload Values:`, JSON.stringify(payload.values));
            for (const res of result.conditionResults) {
                const statusEmoji = res.passed ? '✅ PASSED' : '❌ FAILED';
                console.log(`[ALERTING]   👉 Condition [${res.fieldPath}]: Operator "${res.operator}" | Expected Threshold: ${JSON.stringify(res.expected)} | Actual Found: ${JSON.stringify(res.actual ?? 'undefined')} -> ${statusEmoji}`);
            }
            console.log(`[ALERTING] [Phase 3/4: Evaluation Verdict] Rule "${rule.name}": Matched = ${result.matched} | Observed = ${observed ?? 'n/a'} | Threshold = ${threshold ?? 'n/a'}`);
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
                    console.log(`[ALERTING] 🔄 Alert RECOVERED: "${rule.name}" (${rule.id})`);
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
            console.log(`[ALERTING] [Phase 4/4: Action Gate] 🚨 Rule "${rule.name}" MATCHED! Consecutive Breaches: ${consecutive}/${effective.consecutiveBreaches} | ShouldFire: ${shouldFire} | InCooldown: ${coolingDown}`);
            this.log.info({
                ruleId: rule.id,
                ruleName: rule.name,
                organizationId: rule.organization_id,
                projectId: scope.projectId ?? null,
                engine,
                observed,
                threshold,
            }, 'alert rule matches condition');
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
                console.log(`[ALERTING]   ⏳ SUPPRESSED: Waiting for ${effective.consecutiveBreaches} consecutive breaches (currently ${consecutive}/${effective.consecutiveBreaches}).`);
                summary.suppressed += 1;
                return;
            }
            if (coolingDown) {
                console.log(`[ALERTING]   ⏳ SUPPRESSED: Rule "${rule.name}" is currently in cooldown (${effective.cooldownSeconds}s window active).`);
                summary.suppressed += 1;
                return;
            }
            console.log(`[ALERTING]   🔥 FIRED! Dispatched alert notification decision for "${rule.name}".`);
            await this.appendDecision(rule, effective, scope, payload, engine, 'fired', observed, threshold);
            summary.fired += 1;
        }
        catch (err) {
            summary.failed += 1;
            console.error(`[ALERTING] 💥 Evaluation error for rule "${rule.name}" (${rule.id}):`, err);
            this.log.error({ err, ruleId: rule.id, orgId: rule.organization_id }, 'Runtime alert evaluation failed');
        }
    }
    async appendDecision(rule, effective, scope, payload, engine, kind, observed, threshold) {
        const effectiveProjectRule = buildEffectiveProjectRule(rule, effective, scope);
        if (!effectiveProjectRule)
            return;
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
            console.log(`[ALERTING] 🔔 Alert queued: "${rule.name}" | AlertKey: ${result.alertKey} | Notification Jobs: ${result.notificationJobs.length}`);
            this.log.info({
                alertKey: result.alertKey,
                ruleId: rule.id,
                ruleName: rule.name,
                organizationId: rule.organization_id,
                projectId: scope.projectId ?? null,
                notificationJobs: result.notificationJobs.length,
            }, 'alert queued');
        }
    }
    async enqueueNotificationJob(notificationJobId) {
        await pgboss.send('alert.notification-router', { notificationJobId }, { retryLimit: 3, retryDelay: 10, retryBackoff: true, expireInSeconds: 600 });
    }
    async loadRollupScopes(organizationId, tier, limit) {
        if (tier === 'ai')
            return this.loadAiScopes(organizationId, limit);
        if (tier === 'operational')
            return this.loadOperationalScopes(organizationId, limit);
        return this.loadWindowScopes(organizationId, limit);
    }
    async loadWindowScopes(organizationId, limit) {
        const requestResult = await this.logDb.query(`SELECT organization_id, project_id, environment, bucket,
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
        LIMIT $4`, [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit]);
        const cronResult = await this.logDb.query(`SELECT organization_id, project_id, environment, entity_key, entity_label, monitor_slug, bucket,
              checkin_count, error_count, missed_count, last_status, duration_p95_ms,
              CASE WHEN checkin_count > 0 THEN 100.0 * (error_count + missed_count) / checkin_count ELSE NULL END AS failure_rate
         FROM cron_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '5 minutes'
        ORDER BY bucket DESC
        LIMIT $4`, [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit]);
        const aiResult = await this.logDb.query(`SELECT organization_id, project_id, environment, entity_key, entity_label, bucket,
              request_count, failure_count, latency_p95_ms, latency_p99_ms,
              CASE WHEN request_count > 0 THEN 100.0 * failure_count / request_count ELSE NULL END AS failure_rate
         FROM ai_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '5 minutes'
        ORDER BY bucket DESC
        LIMIT $4`, [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit]);
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
    async loadOperationalScopes(organizationId, limit) {
        const runtimeResult = await this.logDb.query(`SELECT organization_id, project_id, environment, entity_key, entity_label, bucket,
              sample_count, heap_used_mb_avg, heap_used_mb_max, rss_mb_avg, rss_mb_max,
              eventloop_lag_p95_ms, eventloop_lag_p99_ms
         FROM runtime_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '10 minutes'
        ORDER BY bucket DESC
        LIMIT $4`, [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit]);
        const logResult = await this.logDb.query(`SELECT organization_id, project_id, environment, bucket,
              total_count, error_count, warn_count,
              CASE WHEN total_count > 0 THEN 100.0 * error_count / total_count ELSE NULL END AS error_rate
         FROM log_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '10 minutes'
        ORDER BY bucket DESC
        LIMIT $4`, [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit]);
        const serviceResult = await this.logDb.query(`SELECT organization_id, project_id, environment, entity_key, entity_label, bucket,
              total_count, error_count, availability_pct, health_score, latency_p95_ms
         FROM service_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '10 minutes'
        ORDER BY bucket DESC
        LIMIT $4`, [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit]);
        const endpointResult = await this.logDb.query(`SELECT organization_id, project_id, environment, entity_key, entity_label, route, service, bucket,
              total_count, error_count, latency_p95_ms,
              CASE WHEN total_count > 0 THEN 100.0 * (total_count - error_count) / total_count ELSE NULL END AS health_score
         FROM endpoint_metrics_1m
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '10 minutes'
        ORDER BY bucket DESC
        LIMIT $4`, [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit]);
        const metricResult = await this.logDb.query(`SELECT organization_id, project_id, environment, entity_key, entity_label, service, bucket,
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
        LIMIT $4`, [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit]);
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
    async loadAiScopes(organizationId, limit) {
        const result = await this.logDb.query(`SELECT organization_id, project_id, environment, entity_key, entity_label, bucket,
              request_count, failure_count, credits_consumed, cost_micros,
              latency_p95_ms, latency_p99_ms,
              CASE WHEN request_count > 0 THEN 100.0 * failure_count / request_count ELSE NULL END AS failure_rate
         FROM ai_metrics_1h
        WHERE organization_id = $1
          AND project_id <> $2::uuid
          AND environment <> $3
          AND bucket >= NOW() - INTERVAL '2 hours'
        ORDER BY bucket DESC
        LIMIT $4`, [organizationId, ZERO_UUID, ALL_ENVIRONMENTS, limit]);
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
                        cost: { micros: numberOrNull(row.cost_micros), usd: numberOrNull(row.cost_micros) === null ? null : numberOrNull(row.cost_micros) / 1_000_000 },
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
function fastPayload(scoped) {
    const event = scoped.event;
    const record = event;
    const timestamp = new Date(resolveTimestamp(event));
    const values = {
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
    }
    else if (event.type === 'log') {
        const message = typeof record.message === 'string' ? record.message : '';
        values.logs = {
            oom: /out of memory|heap out of memory|oom/i.test(message),
            security: hasSecuritySignal(record),
            message,
            level: record.level,
        };
    }
    else if (event.type === 'cron_checkin') {
        values.cron = {
            failed: record.status === 'error',
            status: record.status,
            monitor: record.monitorSlug,
        };
    }
    else if (event.type === 'request') {
        const rawLatency = record.latency ?? record.latencyMs ?? record.latency_ms ?? record.durationMs ?? record.duration_ms ?? record.duration ?? record.responseTime ?? record.response_time;
        const duration = numberOrNull(rawLatency);
        const statusCode = numberOrNull(record.statusCode ?? record.status_code);
        values.requests = {
            auth_failure: statusCode === 401 || statusCode === 403,
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
function fastSignalPayload(organizationId, signal) {
    const observedAt = signal.occurredAt instanceof Date
        ? signal.occurredAt
        : signal.occurredAt ? new Date(signal.occurredAt) : new Date();
    const values = {
        telemetry: { type: signal.source },
    };
    if (signal.source === 'deployment')
        values.deployment = { failed: signal.kind === 'failed' };
    if (signal.source === 'heartbeat')
        values.heartbeat = { lost: signal.kind === 'lost' || signal.kind === 'timeout' };
    if (signal.source === 'connector')
        values.connector = { failure: signal.kind === 'open_circuit' || signal.kind === 'failure' };
    if (signal.source === 'security')
        values.logs = { security: true };
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
function categoryForRule(conditions, source) {
    const fieldPath = conditions[0]?.field_path?.toLowerCase() ?? '';
    if (fieldPath.startsWith('security') || fieldPath.includes('auth'))
        return 'security';
    if (fieldPath.startsWith('deployment'))
        return 'deployment';
    if (fieldPath.startsWith('cron'))
        return 'cron';
    if (fieldPath.startsWith('ai.'))
        return 'ai';
    if (fieldPath.includes('latency') || fieldPath.includes('availability') || fieldPath.includes('error'))
        return 'performance';
    if (source.includes('billing'))
        return 'billing';
    return 'all';
}
function firstObservedValue(results) {
    for (const result of results) {
        const value = numberOrNull(result.actual);
        if (value !== null)
            return value;
    }
    return null;
}
function firstThresholdValue(conditions) {
    for (const condition of conditions) {
        const value = numberOrNull(condition.threshold_value);
        if (value !== null)
            return value;
    }
    return null;
}
function numberOrNull(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
        return Number(value);
    return null;
}
function hasSecuritySignal(record) {
    const tags = record.tags;
    const message = typeof record.message === 'string' ? record.message : '';
    return /security|csrf|xss|sql injection|auth bypass/i.test(message)
        || (typeof tags === 'object' && tags !== null && Object.values(tags).some((value) => typeof value === 'string' && /security|critical/i.test(value)));
}
function metricSeriesScope(organizationId, row) {
    const metric = typeof row.entity_key === 'string' ? row.entity_key.toLowerCase() : '';
    const value = numberOrNull(row.value_p95) ?? numberOrNull(row.value_last) ?? numberOrNull(row.value_max);
    const values = { metrics: {}, runtime: {}, queue: {}, db: {} };
    const metrics = values.metrics;
    const runtime = values.runtime;
    const queue = values.queue;
    const db = values.db;
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
function hash(value) {
    return createHash('sha256').update(value).digest('hex');
}
function emptySummary() {
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
//# sourceMappingURL=engines.js.map