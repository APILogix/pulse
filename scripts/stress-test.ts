/**
 * Enterprise stress test script.
 *
 * Sends concurrent HTTP requests to the /stress-test endpoint and collects
 * detailed metrics: total, passed, failed, latency distribution, RPS, etc.
 *
 * Usage:
 *   npx tsx scripts/stress-test.ts
 *   npx tsx scripts/stress-test.ts --concurrency 50 --requests 500 --intensity medium
 */

interface TestConfig {
  baseUrl: string;
  endpoint: string;
  intensity: 'light' | 'medium' | 'heavy' | 'extreme';
  totalRequests: number;
  concurrency: number;
  timeoutMs: number;
}

interface RequestResult {
  success: boolean;
  statusCode: number;
  latencyMs: number;
  error?: string;
}

interface TestMetrics {
  totalRequests: number;
  passed: number;
  failed: number;
  timeouts: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  rps: number;
  totalDurationMs: number;
  errors: Record<string, number>;
  statusCodes: Record<string, number>;
}

function parseArgs(): Partial<TestConfig> {
  const args: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i]?.startsWith('--')) {
      const key = process.argv[i]!.slice(2);
      const value = process.argv[i + 1];
      if (value && !value.startsWith('--')) {
        args[key] = value;
        i++;
      }
    }
  }
  return args;
}

async function sendRequest(url: string, timeoutMs: number): Promise<RequestResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const latency = Date.now() - start;
    const success = response.ok;

    return {
      success,
      statusCode: response.status,
      latencyMs: latency,
    };
  } catch (err: any) {
    const latency = Date.now() - start;
    const isTimeout = err.name === 'AbortError' || err.code === 'UND_ERR_SOCKET_TIMEOUT';

    return {
      success: false,
      statusCode: isTimeout ? 408 : 0,
      latencyMs: latency,
      error: isTimeout ? 'timeout' : err.message || 'unknown',
    };
  }
}

async function runStressTest(config: TestConfig): Promise<TestMetrics> {
  const { baseUrl, endpoint, intensity, totalRequests, concurrency, timeoutMs } = config;
  const url = `${baseUrl}${endpoint}?intensity=${intensity}`;

  console.log('\n' + '='.repeat(70));
  console.log('  ENTERPRISE STRESS TEST');
  console.log('='.repeat(70));
  console.log(`  Target:     ${url}`);
  console.log(`  Intensity:  ${intensity}`);
  console.log(`  Requests:   ${totalRequests}`);
  console.log(`  Concurrency: ${concurrency}`);
  console.log(`  Timeout:    ${timeoutMs}ms`);
  console.log('='.repeat(70) + '\n');

  const results: RequestResult[] = [];
  const startTime = Date.now();
  let completed = 0;

  async function worker() {
    while (completed < totalRequests) {
      const reqIndex = completed++;
      const result = await sendRequest(url, timeoutMs);
      results.push(result);

      if ((reqIndex + 1) % 50 === 0 || reqIndex === totalRequests - 1) {
        const elapsed = Date.now() - startTime;
        const rps = ((reqIndex + 1) / elapsed * 1000).toFixed(1);
        process.stdout.write(`\r  Progress: ${reqIndex + 1}/${totalRequests} | RPS: ${rps}`);
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  const totalDuration = Date.now() - startTime;
  return calculateMetrics(results, totalDuration, totalRequests);
}

function calculateMetrics(results: RequestResult[], totalDurationMs: number, totalRequests: number): TestMetrics {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success && r.statusCode !== 408).length;
  const timeouts = results.filter((r) => r.statusCode === 408).length;

  const errors: Record<string, number> = {};
  const statusCodes: Record<string, number> = {};

  for (const r of results) {
    const code = r.statusCode.toString();
    statusCodes[code] = (statusCodes[code] || 0) + 1;

    if (!r.success && r.error) {
      errors[r.error] = (errors[r.error] || 0) + 1;
    }
  }

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  const rps = (totalRequests / totalDurationMs) * 1000;

  return {
    totalRequests,
    passed,
    failed,
    timeouts,
    avgLatencyMs: Math.round(avgLatency),
    minLatencyMs: latencies[0] || 0,
    maxLatencyMs: latencies[latencies.length - 1] || 0,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    rps: Math.round(rps * 10) / 10,
    totalDurationMs,
    errors,
    statusCodes,
  };
}

function printReport(metrics: TestMetrics, config: TestConfig): void {
  console.log('\n\n' + '='.repeat(70));
  console.log('  STRESS TEST RESULTS');
  console.log('='.repeat(70));

  console.log('\n  REQUEST SUMMARY');
  console.log('  ' + '-'.repeat(40));
  console.log(`  Total Requests:    ${metrics.totalRequests}`);
  console.log(`  Passed (2xx):      ${metrics.passed}`);
  console.log(`  Failed (4xx/5xx):  ${metrics.failed}`);
  console.log(`  Timeouts:          ${metrics.timeouts}`);
  console.log(`  Success Rate:      ${((metrics.passed / metrics.totalRequests) * 100).toFixed(2)}%`);

  console.log('\n  THROUGHPUT');
  console.log('  ' + '-'.repeat(40));
  console.log(`  Requests/sec (RPS): ${metrics.rps}`);
  console.log(`  Total Duration:     ${metrics.totalDurationMs}ms (${(metrics.totalDurationMs / 1000).toFixed(2)}s)`);

  console.log('\n  LATENCY DISTRIBUTION');
  console.log('  ' + '-'.repeat(40));
  console.log(`  Min:    ${metrics.minLatencyMs}ms`);
  console.log(`  Avg:    ${metrics.avgLatencyMs}ms`);
  console.log(`  p50:    ${metrics.p50LatencyMs}ms`);
  console.log(`  p95:    ${metrics.p95LatencyMs}ms`);
  console.log(`  p99:    ${metrics.p99LatencyMs}ms`);
  console.log(`  Max:    ${metrics.maxLatencyMs}ms`);

  console.log('\n  STATUS CODES');
  console.log('  ' + '-'.repeat(40));
  for (const [code, count] of Object.entries(metrics.statusCodes).sort()) {
    const pct = ((count / metrics.totalRequests) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / metrics.totalRequests * 40));
    console.log(`  ${code.padEnd(6)} ${count.toString().padStart(6)} (${pct}%) ${bar}`);
  }

  if (Object.keys(metrics.errors).length > 0) {
    console.log('\n  ERRORS');
    console.log('  ' + '-'.repeat(40));
    for (const [error, count] of Object.entries(metrics.errors)) {
      console.log(`  ${error}: ${count}`);
    }
  }

  console.log('\n  PERFORMANCE GRADE');
  console.log('  ' + '-'.repeat(40));

  let grade = 'A+';
  const successRate = (metrics.passed / metrics.totalRequests) * 100;

  if (successRate < 90) grade = 'F';
  else if (successRate < 95) grade = 'D';
  else if (successRate < 99) grade = 'C';
  else if (metrics.p99LatencyMs > 10000) grade = 'B-';
  else if (metrics.p99LatencyMs > 5000) grade = 'B';
  else if (metrics.p99LatencyMs > 2000) grade = 'B+';
  else if (metrics.rps > 100) grade = 'A';

  console.log(`  Grade: ${grade}`);
  console.log(`  RPS:   ${metrics.rps}`);
  console.log(`  p99:   ${metrics.p99LatencyMs}ms`);

  console.log('\n' + '='.repeat(70) + '\n');
}

async function main() {
  const args = parseArgs();

  const config: TestConfig = {
    baseUrl: args.baseUrl || 'http://localhost:3000',
    endpoint: args.endpoint || '/stress-test',
    intensity: (args.intensity as TestConfig['intensity']) || 'medium',
    totalRequests: parseInt(args.requests || '200', 10),
    concurrency: parseInt(args.concurrency || '20', 10),
    timeoutMs: parseInt(args.timeout || '30000', 10),
  };

  try {
    const metrics = await runStressTest(config);
    printReport(metrics, config);
  } catch (err) {
    console.error('Stress test failed:', err);
    process.exit(1);
  }
}

main();
