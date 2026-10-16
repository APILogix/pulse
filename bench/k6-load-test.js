/**
 * k6 Load Test Script for Pulse Performance Measurement.
 *
 * Simulates 100 - 500 RPS across 5 representative API endpoints:
 * 1. GET  /v1/init                    (API key verification & cache hit)
 * 2. GET  /v1/sdk-config              (Compiled SDK schema delivery)
 * 3. GET  /v1/traces/:id              (Span lookup)
 * 4. GET  /v1/dashboard/metrics       (TimescaleDB continuous aggregate rollup)
 * 5. GET  /admin/perf/latency-summary (Performance diagnostic overview)
 *
 * Run with:
 *   k6 run bench/k6-load-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp-up to 50 VUs (~100 RPS)
    { duration: '1m', target: 200 },  // Ramp-up to 200 VUs (~300 RPS)
    { duration: '30s', target: 350 }, // Peak at 350 VUs (~500 RPS)
    { duration: '30s', target: 0 },   // Cool down
  ],
  thresholds: {
    // Global p95 latency must be under 200ms; error rate < 1%
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://127.0.0.1:3000';
const API_KEY = __ENV.TEST_API_KEY || 'pk_live_bench_seed_key_12345';

export default function () {
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
      'X-Request-ID': `k6-req-${__VU}-${__ITER}`,
      'X-Org-Tier': 'enterprise',
      'X-Perf-Sample': 'true', // Triggers Server-Timing header
    },
  };

  // 1. SDK Init Endpoint
  const initRes = http.get(`${BASE_URL}/v1/init`, params);
  check(initRes, {
    'init status is 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  // 2. SDK Config Delivery Endpoint
  const configRes = http.get(`${BASE_URL}/v1/sdk-config`, params);
  check(configRes, {
    'config status is 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  // 3. Spans & Traces Search
  const traceRes = http.get(`${BASE_URL}/v1/traces/sample-trace-id`, params);
  check(traceRes, {
    'trace response received': (r) => r.status === 200 || r.status === 404 || r.status === 401,
  });

  // 4. Dashboard Rollup Metrics
  const metricsRes = http.get(`${BASE_URL}/v1/dashboard/metrics?window=1h`, params);
  check(metricsRes, {
    'metrics response received': (r) => r.status === 200 || r.status === 404 || r.status === 401,
  });

  // 5. Admin Performance Latency Summary
  const perfRes = http.get(`${BASE_URL}/admin/perf/latency-summary`, params);
  check(perfRes, {
    'latency summary status is 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  sleep(0.05); // 50ms pause between VU iterations
}
