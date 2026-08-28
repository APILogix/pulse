import promClient from 'prom-client';
import { register } from '../../../config/metrics.js';
function counter(name, help, labelNames = []) {
    const existing = register.getSingleMetric(name);
    if (existing)
        return existing;
    return new promClient.Counter({ name, help, labelNames, registers: [register] });
}
function histogram(name, help, labelNames = [], buckets) {
    const existing = register.getSingleMetric(name);
    if (existing)
        return existing;
    return new promClient.Histogram({
        name,
        help,
        labelNames,
        buckets: buckets ?? [0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000],
        registers: [register],
    });
}
// L1 Rule Catalog metrics
const cacheHitCounter = counter('alert_rule_cache_hit_total', 'Total number of L1 alert rule catalog cache hits', ['tier']);
const cacheMissCounter = counter('alert_rule_cache_miss_total', 'Total number of L1 alert rule catalog cache misses', ['tier']);
const cacheLoadCounter = counter('alert_rule_cache_load_total', 'Total number of alert rule catalog snapshots loaded from database', ['tier']);
const cacheInvalidationCounter = counter('alert_rule_cache_invalidation_total', 'Total number of L1 alert rule catalog cache invalidations', ['reason']);
// Redis runtime state metrics
const redisCooldownAcquireSuccessCounter = counter('alert_redis_cooldown_acquire_success_total', 'Total number of successful alert cooldown acquisitions in Redis', ['tier']);
const redisCooldownAcquireRejectedCounter = counter('alert_redis_cooldown_acquire_rejected_total', 'Total number of alert evaluations rejected due to active Redis cooldown', ['tier']);
const redisErrorsCounter = counter('alert_redis_errors_total', 'Total number of Redis errors encountered during alert runtime operations', ['operation']);
const redisLatencyHistogram = histogram('alert_redis_latency_ms', 'Latency of Redis alert runtime operations in milliseconds', ['operation']);
export function recordCatalogCacheHit(tier) {
    cacheHitCounter.inc({ tier });
}
export function recordCatalogCacheMiss(tier) {
    cacheMissCounter.inc({ tier });
}
export function recordCatalogCacheLoad(tier) {
    cacheLoadCounter.inc({ tier });
}
export function recordCatalogCacheInvalidation(reason = 'mutation') {
    cacheInvalidationCounter.inc({ reason });
}
export function recordRedisCooldownSuccess(tier) {
    redisCooldownAcquireSuccessCounter.inc({ tier });
}
export function recordRedisCooldownRejected(tier) {
    redisCooldownAcquireRejectedCounter.inc({ tier });
}
export function recordRedisError(operation) {
    redisErrorsCounter.inc({ operation });
}
export function recordRedisLatency(operation, latencyMs) {
    redisLatencyHistogram.observe({ operation }, latencyMs);
}
// ── Evaluation + decision lifecycle metrics ─────────────────────────────────
// Required observability surface for the alerting hardening work: every stage of
// the evaluation/decision pipeline must be countable without reading logs.
const evaluationCounter = counter('alert_evaluation_total', 'Total alert rule candidate evaluations that produced a verdict', ['tier']);
const evaluationMatchedCounter = counter('alert_evaluation_matched_total', 'Total alert rule evaluations whose conditions matched', ['tier']);
const evaluationSkippedCounter = counter('alert_evaluation_skipped_total', 'Total alert rule evaluations skipped before a verdict', ['tier', 'reason']);
const evaluationFailedCounter = counter('alert_evaluation_failed_total', 'Total alert rule evaluations that errored or could not be decided', ['tier', 'reason']);
const evaluationStaleCounter = counter('alert_evaluation_stale_total', 'Total alert rule evaluations skipped because the source rollup was too stale to trust', ['tier']);
const evaluationLatencyHistogram = histogram('alert_evaluation_latency_ms', 'End-to-end latency of one alert evaluation batch in milliseconds', ['tier']);
const alertTriggeredCounter = counter('alert_triggered_total', 'Total alerts fired', ['tier']);
const alertRecoveredCounter = counter('alert_recovered_total', 'Total alerts recovered', ['tier']);
const alertCooldownBlockedCounter = counter('alert_cooldown_blocked_total', 'Total alert fires suppressed by an active cooldown window', ['tier', 'gate']);
const alertDeduplicatedCounter = counter('alert_deduplicated_total', 'Total alert decisions collapsed onto an existing alert by idempotency/dedup', ['tier']);
export function recordEvaluated(tier) {
    evaluationCounter.inc({ tier });
}
export function recordEvaluationMatched(tier) {
    evaluationMatchedCounter.inc({ tier });
}
export function recordEvaluationSkipped(tier, reason) {
    evaluationSkippedCounter.inc({ tier, reason });
}
export function recordEvaluationFailed(tier, reason = 'error') {
    evaluationFailedCounter.inc({ tier, reason });
}
export function recordEvaluationStale(tier) {
    evaluationStaleCounter.inc({ tier });
}
export function recordEvaluationLatency(tier, latencyMs) {
    evaluationLatencyHistogram.observe({ tier }, latencyMs);
}
export function recordAlertTriggered(tier) {
    alertTriggeredCounter.inc({ tier });
}
export function recordAlertRecovered(tier) {
    alertRecoveredCounter.inc({ tier });
}
/** `gate` distinguishes the cheap Redis fast-path filter from the authoritative DB gate. */
export function recordCooldownBlocked(tier, gate) {
    alertCooldownBlockedCounter.inc({ tier, gate });
}
export function recordAlertDeduplicated(tier) {
    alertDeduplicatedCounter.inc({ tier });
}
const alertAutoResolvedCounter = counter('alert_auto_resolved_total', 'Total alerts closed by the auto-resolve deadline sweep (timeout-based, not a verified recovery)');
export function recordAlertAutoResolved() {
    alertAutoResolvedCounter.inc();
}
// ── Incident lifecycle metrics (Phase 28) ───────────────────────────────────
const incidentOpenedCounter = counter('alert_incident_opened_total', 'Incidents newly opened (a fingerprint had no active incident)', ['tier']);
const incidentReusedCounter = counter('alert_incident_reused_total', 'Alert matches folded into an already-active incident instead of opening a new one', ['tier']);
const incidentResolvedCounter = counter('alert_incident_resolved_total', 'Incidents moved to resolved', ['origin']);
const incidentAcknowledgedCounter = counter('alert_incident_acknowledged_total', 'Incidents acknowledged by a user');
const incidentPersistFailedCounter = counter('alert_incident_persist_failed_total', 'Incident persistence failures. Never silent: alert delivery still proceeds.', ['operation']);
export function recordIncidentOpened(tier) {
    incidentOpenedCounter.inc({ tier });
}
export function recordIncidentReused(tier) {
    incidentReusedCounter.inc({ tier });
}
/** `origin` distinguishes an evaluated recovery from a manual API resolve. */
export function recordIncidentResolved(origin) {
    incidentResolvedCounter.inc({ origin });
}
export function recordIncidentAcknowledged() {
    incidentAcknowledgedCounter.inc();
}
export function recordIncidentPersistFailed(operation) {
    incidentPersistFailedCounter.inc({ operation });
}
//# sourceMappingURL=alert-runtime-metrics.js.map