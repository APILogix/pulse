import { performance } from "node:perf_hooks";
import { pool, connectDB } from "../src/config/database.js";
import { connectRedis, redis } from "../src/config/redis.js";

const RAW_API_KEY = "pv_live_9039548f506985f832b42f16.fccedcad3f2440f86bd0e686464126e43acf28b606a2acda7fc2eb5e09011c04";
const ENDPOINT = "http://localhost:5000/v1/init";

interface BenchResult {
  concurrency: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  durations: number[];
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  avg: number;
}

function calculatePercentiles(latencies: number[]): { p50: number; p95: number; p99: number; min: number; max: number; avg: number } {
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const min = latencies[0];
  const max = latencies[latencies.length - 1];
  const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
  return { p50, p95, p99, min, max, avg };
}

async function runBatch(concurrency: number, iterationsPerWorker = 1): Promise<BenchResult> {
  const total = concurrency * iterationsPerWorker;
  const durations: number[] = [];
  let successCount = 0;
  let errorCount = 0;

  const statusCounts: Record<number, number> = {};

  const runWorker = async () => {
    for (let i = 0; i < iterationsPerWorker; i++) {
      const start = performance.now();
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": RAW_API_KEY,
          },
          body: JSON.stringify({}),
        });
        const duration = performance.now() - start;
        durations.push(duration);
        statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
        if (res.status === 200) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch (err) {
        const duration = performance.now() - start;
        durations.push(duration);
        errorCount++;
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => runWorker());
  await Promise.all(workers);

  const stats = calculatePercentiles(durations);
  return {
    concurrency,
    totalRequests: total,
    successCount,
    errorCount,
    durations,
    ...stats,
  };
}

async function main() {
  console.log("==========================================================");
  console.log("   SDK /init END-TO-END CONCURRENCY & LATENCY BENCHMARK   ");
  console.log("==========================================================");
  await connectDB();
  await connectRedis();

  // Warm up connection
  console.log("Warming up endpoint...");
  await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": RAW_API_KEY },
    body: JSON.stringify({}),
  });

  const levels = [1, 10, 50, 100];
  const results: BenchResult[] = [];

  for (const c of levels) {
    // Clear delivery rate-limit keys for pure concurrency measurement
    const rlKeys = await redis.keys("*security:ratelimit:delivery*");
    if (rlKeys.length > 0) {
      await redis.del(...rlKeys);
    }
    console.log(`Running Concurrency: ${c} requests...`);
    const res = await runBatch(c, 1);
    results.push(res);
    console.log(`  -> Concurrency ${c}: p50=${res.p50.toFixed(2)}ms, p95=${res.p95.toFixed(2)}ms, p99=${res.p99.toFixed(2)}ms, max=${res.max.toFixed(2)}ms, success=${res.successCount}/${res.totalRequests}`);
    // Brief pause between bursts
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("\n==========================================================");
  console.log("                 FINAL BENCHMARK RESULTS                  ");
  console.log("==========================================================");
  console.log("Concurrency | Requests | Success | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms)");
  console.log("-------------------------------------------------------------------------");
  for (const r of results) {
    console.log(
      `${String(r.concurrency).padEnd(11)} | ` +
      `${String(r.totalRequests).padEnd(8)} | ` +
      `${String(r.successCount).padEnd(7)} | ` +
      `${r.p50.toFixed(2).padEnd(8)} | ` +
      `${r.p95.toFixed(2).padEnd(8)} | ` +
      `${r.p99.toFixed(2).padEnd(8)} | ` +
      `${r.max.toFixed(2)}`
    );
  }

  // Check Redis TTL on the project key
  const projectId = "3606c81a-16bb-426b-a113-03fb17f80472";
  const ttl = await redis.ttl(`remote-config:${projectId}`);
  console.log("\nPersistent Cache Verification:");
  console.log(`Redis Key: remote-config:${projectId}`);
  console.log(`Redis TTL: ${ttl} (${ttl === -1 ? "PERSISTENT / NO TTL - CONFIRMED" : "WARNING: TTL DETECTED"})`);

  // Connection pool & Memory stats
  console.log("\nSystem Health Stats:");
  console.log(`Pool Total Count: ${pool.totalCount}, Idle Count: ${pool.idleCount}, Waiting: ${pool.waitingCount}`);
  const mem = process.memoryUsage();
  console.log(`RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB, Heap Used: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);

  await pool.end();
  await redis.quit();
}

main().catch(console.error);
