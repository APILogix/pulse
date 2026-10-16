import { describe, it, expect } from 'vitest';
import {
  cacheRequestsTotalCounter,
  cacheOpDurationHistogram,
  recordCacheRequest,
  recordCacheOp,
} from '../../src/config/perf/metrics.js';
import { register } from '../../src/config/metrics.js';

describe('Tier 2.6: Cache Metrics (Prometheus instrumentation & /metrics exposure)', () => {
  it('cache_requests_total counter has labels [cache, result]', async () => {
    recordCacheRequest('entitlements', 'hit');
    recordCacheRequest('entitlements', 'miss');
    recordCacheRequest('projectRole', 'hit');

    const metricsStr = await register.metrics();
    expect(metricsStr).toContain('cache_requests_total');
    expect(metricsStr).toMatch(/cache_requests_total\{cache="entitlements",result="hit"\}/);
    expect(metricsStr).toMatch(/cache_requests_total\{cache="entitlements",result="miss"\}/);
    expect(metricsStr).toMatch(/cache_requests_total\{cache="projectRole",result="hit"\}/);
  });

  it('cache_op_duration_seconds histogram has labels [op, cache]', async () => {
    recordCacheOp('get', 'observabilityQuery', 12.5);
    recordCacheOp('set', 'observabilityQuery', 3.2);

    const metricsStr = await register.metrics();
    expect(metricsStr).toContain('cache_op_duration_seconds_bucket');
    expect(metricsStr).toMatch(/cache_op_duration_seconds.*op="get",cache="observabilityQuery"/);
    expect(metricsStr).toMatch(/cache_op_duration_seconds.*op="set",cache="observabilityQuery"/);
  });

  it('Exposes metrics cleanly on central Prometheus registry', async () => {
    const singleMetric = register.getSingleMetric('cache_requests_total');
    expect(singleMetric).toBeDefined();

    const histMetric = register.getSingleMetric('cache_op_duration_seconds');
    expect(histMetric).toBeDefined();
  });
});
