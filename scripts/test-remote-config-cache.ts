import { pool, connectDB } from "../src/config/database.js";
import { connectRedis, redis } from "../src/config/redis.js";
import { PgConfigStore } from "../src/modules/projects/sdk-config/sdk-config.repository.js";
import { RemoteSdkConfigService } from "../src/modules/projects/sdk-config/sdk-config.service.js";
import { performance } from "node:perf_hooks";

async function main() {
  await connectDB();
  await connectRedis();

  const projectId = "3606c81a-16bb-426b-a113-03fb17f80472";
  const orgId = "5c67def8-2f5d-4358-b78d-59b7aa776059";
  const envId = "8995b826-49be-45a0-ab39-729a05048b9a";

  const store = new PgConfigStore(pool);
  const service = new RemoteSdkConfigService(store, {
    topology: { ingestBaseUrl: "http://localhost:5000/api" },
  });

  const mapping = {
    organizationId: orgId,
    projectId,
    defaultEnvironmentId: envId,
    allowedEnvironmentIds: [envId],
  };

  console.log("Building delivery from Postgres...");
  const t0 = performance.now();
  const delivery = await service.buildDelivery(mapping, {});
  const buildMs = performance.now() - t0;
  console.log(`Delivery built in ${buildMs.toFixed(2)}ms`);

  const cacheKey = `remote-config:${projectId}`;
  const cachedDoc = {
    version: delivery.revisionNo,
    projectId: delivery.projectId,
    organizationId: delivery.organizationId,
    environmentId: delivery.environmentId,
    environment: delivery.config.sdk.environment,
    release: delivery.config.sdk.release,
    etag: delivery.etag,
    configHash: delivery.config.meta.configHash,
    config: delivery.config,
  };

  console.log(`Setting Redis key '${cacheKey}' WITHOUT TTL...`);
  await redis.set(cacheKey, JSON.stringify(cachedDoc));

  const ttl = await redis.ttl(cacheKey);
  console.log(`Redis TTL for '${cacheKey}' is: ${ttl} (Expected: -1 for persistent / no TTL)`);

  console.log("Testing Warm Redis GET latency (10 iterations)...");
  const latencies: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const raw = await redis.get(cacheKey);
    const parsed = JSON.parse(raw!);
    const ms = performance.now() - start;
    latencies.push(ms);
  }

  latencies.sort((a, b) => a - b);
  console.log("Redis GET latencies (ms):", latencies.map(l => l.toFixed(2)));
  console.log(`Min: ${latencies[0].toFixed(2)}ms, Median: ${latencies[Math.floor(latencies.length/2)].toFixed(2)}ms, Max: ${latencies[latencies.length-1].toFixed(2)}ms`);

  await pool.end();
  await redis.quit();
}

main().catch(console.error);
