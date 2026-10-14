const BASE_URL = 'http://127.0.0.1:5000';

interface BenchResult {
  endpoint: string;
  method: string;
  status: number;
  latencies: number[];
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
}

function calcStats(latencies: number[]) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  return { p50, p95, p99, avg, min, max };
}

async function benchmarkEndpoint(
  name: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  iterations = 10,
): Promise<BenchResult> {
  const latencies: number[] = [];
  let status = 0;

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      status = res.status;
      await res.text(); // consume body
      const duration = performance.now() - start;
      latencies.push(duration);
    } catch (err: any) {
      const duration = performance.now() - start;
      latencies.push(duration);
      console.error(`Error on ${name}:`, err.message);
    }
  }

  const stats = calcStats(latencies);
  return {
    endpoint: path,
    method,
    status,
    latencies,
    ...stats,
  };
}

async function run() {
  console.log('================================================================');
  console.log('BENCHMARKING ENDPOINTS END-TO-END (10 ITERATIONS EACH)');
  console.log('================================================================');

  const tests = [
    { name: 'Shallow Liveness (/health)', method: 'GET', path: '/health' },
    { name: 'Liveness Alias (/live)', method: 'GET', path: '/live' },
    { name: 'Deep Readiness Probe (/ready)', method: 'GET', path: '/ready' },
    { name: 'Auth Module Health (/auth/health)', method: 'GET', path: '/auth/health' },
    { name: 'Diagnostics Memory (/diagnostics/memory)', method: 'GET', path: '/diagnostics/memory' },
    {
      name: 'Auth Login (Validation Reject)',
      method: 'POST',
      path: '/auth/login',
      body: { email: 'nonexistent@test.com', password: 'Short' },
    },
    {
      name: 'SDK Init (No Key - 401)',
      method: 'POST',
      path: '/api/v1/init',
      body: {},
    },
    {
      name: 'Ingestion Requests (No Key - 401)',
      method: 'POST',
      path: '/api/v1/ingest/requests',
      body: { events: [] },
    },
  ];

  const results: BenchResult[] = [];

  for (const t of tests) {
    process.stdout.write(`Benchmarking ${t.name}... `);
    const res = await benchmarkEndpoint(t.name, t.method, t.path, t.body);
    console.log(`HTTP ${res.status} | p50: ${res.p50.toFixed(1)}ms | p95: ${res.p95.toFixed(1)}ms | avg: ${res.avg}ms (min: ${res.min.toFixed(1)}ms, max: ${res.max.toFixed(1)}ms)`);
    results.push(res);
  }

  console.log('\n================================================================');
  console.log('SUMMARY TABLE');
  console.log('================================================================');
  console.table(
    results.map((r) => ({
      Endpoint: r.endpoint,
      Method: r.method,
      Status: r.status,
      'Avg (ms)': r.avg,
      'p50 (ms)': Math.round(r.p50),
      'p95 (ms)': Math.round(r.p95),
      'Min (ms)': Math.round(r.min),
      'Max (ms)': Math.round(r.max),
    })),
  );
}

run().catch(console.error);
