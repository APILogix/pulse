import { performance } from "node:perf_hooks";

const API_KEY = "pv_live_c78781a83084d4fffe63fac1.3e47fdaec683c36b27b9b04aad0a1b42673c290011a966463f8e6de872ab3730";
const BASE_URL = "http://127.0.0.1:5000";

async function testInit(endpoint: string, iterations = 3) {
  console.log(`\n=== Testing ${endpoint} (${iterations} iterations) ===`);
  for (let i = 1; i <= iterations; i++) {
    const start = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({}),
        signal: ctrl.signal,
      });
      const elapsed = performance.now() - start;
      const status = res.status;
      const json = await res.json();
      console.log(`[Run ${i}] Status: ${status} in ${elapsed.toFixed(1)}ms`);
      if (status !== 200) {
        console.error("Error Response:", JSON.stringify(json, null, 2));
      } else {
        console.log(`Success! Project: ${json.projectId}, Rev: ${json.configRevision}, ETag: ${res.headers.get("etag")}`);
      }
    } catch (err: any) {
      const elapsed = performance.now() - start;
      console.error(`[Run ${i}] Request failed in ${elapsed.toFixed(1)}ms:`, err.message, err.cause?.code || "");
    } finally {
      clearTimeout(timer);
    }
  }
}

async function benchmarkRoute(path: string, count = 10) {
  console.log(`\n========================================`);
  console.log(`Running benchmark on ${path} (${count} runs)...`);
  console.log(`========================================`);
  const latencies: number[] = [];
  let successCount = 0;

  for (let i = 1; i <= count; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch(`http://127.0.0.1:5000${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
        },
        body: JSON.stringify({}),
      });
      const elapsed = performance.now() - t0;
      latencies.push(elapsed);
      if (res.status === 200) {
        successCount++;
        const json = await res.json();
        console.log(`[Run ${i}] 200 OK in ${elapsed.toFixed(1)}ms (Revision: ${json.configRevision}, Plan: ${json.plan})`);
      } else {
        const json = await res.json();
        console.error(`[Run ${i}] FAILED status=${res.status} in ${elapsed.toFixed(1)}ms:`, json);
      }
    } catch (err: any) {
      console.error(`[Run ${i}] NETWORK ERROR in ${(performance.now() - t0).toFixed(1)}ms:`, err.message);
    }
  }

  latencies.sort((a, b) => a - b);
  const min = latencies[0];
  const max = latencies[latencies.length - 1];
  const median = latencies[Math.floor(latencies.length / 2)];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  console.log(`\n--- Benchmark Summary for ${path} ---`);
  console.log(`Total Requests: ${count}`);
  console.log(`Success Rate: ${((successCount / count) * 100).toFixed(0)}% (${successCount}/${count})`);
  console.log(`Min Latency:    ${min.toFixed(1)}ms`);
  console.log(`Median Latency: ${median.toFixed(1)}ms`);
  console.log(`Average Latency:${avg.toFixed(1)}ms`);
  console.log(`Max Latency:    ${max.toFixed(1)}ms`);
}

async function run() {
  await benchmarkRoute("/init", 10);
  await benchmarkRoute("/v1/init", 10);
}

run().catch(console.error);
