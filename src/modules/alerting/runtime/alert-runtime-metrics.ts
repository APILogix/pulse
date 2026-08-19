import promClient from 'prom-client';
import { register } from '../../../config/metrics.js';

function counter(name: string, help: string, labelNames: string[] = []): promClient.Counter<string> {
  const existing = register.getSingleMetric(name);
  if (existing) return existing as promClient.Counter<string>;
  return new promClient.Counter({ name, help, labelNames, registers: [register] });
}

function histogram(name: string, help: string, labelNames: string[] = [], buckets?: number[]): promClient.Histogram<string> {
  const existing = register.getSingleMetric(name);
  if (existing) return existing as promClient.Histogram<string>;
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
const redisCooldownAcquireSuccessCounter = counter(
  'alert_redis_cooldown_acquire_success_total',
  'Total number of successful alert cooldown acquisitions in Redis',
  ['tier'],
);
const redisCooldownAcquireRejectedCounter = counter(
  'alert_redis_cooldown_acquire_rejected_total',
  'Total number of alert evaluations rejected due to active Redis cooldown',
  ['tier'],
);
const redisErrorsCounter = counter(
  'alert_redis_errors_total',
  'Total number of Redis errors encountered during alert runtime operations',
  ['operation'],
);
const redisLatencyHistogram = histogram(
  'alert_redis_latency_ms',
  'Latency of Redis alert runtime operations in milliseconds',
  ['operation'],
);

export function recordCatalogCacheHit(tier: string): void {
  cacheHitCounter.inc({ tier });
}

export function recordCatalogCacheMiss(tier: string): void {
  cacheMissCounter.inc({ tier });
}

export function recordCatalogCacheLoad(tier: string): void {
  cacheLoadCounter.inc({ tier });
}

export function recordCatalogCacheInvalidation(reason = 'mutation'): void {
  cacheInvalidationCounter.inc({ reason });
}

export function recordRedisCooldownSuccess(tier: string): void {
  redisCooldownAcquireSuccessCounter.inc({ tier });
}

export function recordRedisCooldownRejected(tier: string): void {
  redisCooldownAcquireRejectedCounter.inc({ tier });
}

export function recordRedisError(operation: string): void {
  redisErrorsCounter.inc({ operation });
}

export function recordRedisLatency(operation: string, latencyMs: number): void {
  redisLatencyHistogram.observe({ operation }, latencyMs);
}
