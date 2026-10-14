import { pool, connectDB } from "../src/config/database.js";
import { connectRedis, redis } from "../src/config/redis.js";
import { redisLookupCache } from "../src/db/redis/lookup-cache.js";
import { extractApiKeyPrefix, constantTimeEqualHex, hashApiKey } from "../src/modules/projects/shared/utils.js";
import { sha256Hex, constantTimeHexEqual } from "../src/modules/projects/sdk-config/security.js";
import { entitlementsService } from "../src/modules/billing/entitlements/service.js";
import { PgConfigStore } from "../src/modules/projects/sdk-config/sdk-config.repository.js";
import { RemoteSdkConfigService } from "../src/modules/projects/sdk-config/sdk-config.service.js";
import { performance } from "node:perf_hooks";

const rawKey = "pv_live_9039548f506985f832b42f16.fccedcad3f2440f86bd0e686464126e43acf28b606a2acda7fc2eb5e09011c04";

async function measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  console.log(`[START] ${name}...`);
  try {
    const res = await fn();
    const duration = performance.now() - start;
    console.log(`[DONE]  ${name} took ${duration.toFixed(2)}ms`);
    return res;
  } catch (err: any) {
    const duration = performance.now() - start;
    console.error(`[FAIL]  ${name} failed after ${duration.toFixed(2)}ms:`, err.message);
    throw err;
  }
}

async function run() {
  console.log("=== DETAILED /init COMPONENT TIMING PROFILER ===");
  await connectDB();
  await connectRedis();

  console.log("\n--- STAGE 1: Redis Connectivity & Raw Latency ---");
  await measure("Redis PING", () => redis.ping());
  await measure("Redis GET missing key", () => redis.get("some:dummy:missing:key"));
  await measure("Redis SET test key", () => redis.set("test:timing", "hello", "EX", 60));
  await measure("Redis GET test key", () => redis.get("test:timing"));

  console.log("\n--- STAGE 2: redisLookupCache Read Overhead ---");
  await measure("redisLookupCache.getApiKeyMapping (miss)", () => redisLookupCache.getApiKeyMapping(rawKey));
  await measure("redisLookupCache.isKeyNegativeCached", () => redisLookupCache.isKeyNegativeCached(rawKey));
  await measure("redisLookupCache.isIpJailed", () => redisLookupCache.isIpJailed("127.0.0.1"));
  await measure("redisLookupCache.checkDeliveryRateLimit", () => redisLookupCache.checkDeliveryRateLimit("test-id", 120, 60));

  console.log("\n--- STAGE 3: API Key DB Query (Slow-Path) ---");
  const publicKey = extractApiKeyPrefix(rawKey);
  console.log("Extracted public key:", publicKey);
  const dbKeyRow = await measure("Postgres API Key lookup query", async () => {
    const result = await pool.query(
      `SELECT p.org_id AS organization_id, 
              k.id AS key_id,
              k.project_id, 
              k.environment_id, 
              k.secret_hash,
              k.allowed_ips,
              k.allowed_endpoints
         FROM project_api_keys k
         JOIN projects p ON p.id = k.project_id AND p.deleted_at IS NULL
        WHERE k.public_key = $1 
          AND k.status = 'active' 
          AND (k.is_active IS NULL OR k.is_active = TRUE)
          AND (k.expires_at IS NULL OR k.expires_at > NOW())
          AND (p.status IS NULL OR p.status = 'active')
          AND k.deleted_at IS NULL
        LIMIT 1`,
      [publicKey],
    );
    return result.rows[0];
  });
  console.log("DB Key Row result found:", !!dbKeyRow);

  console.log("\n--- STAGE 4: SDK Config DB Queries ---");
  const store = new PgConfigStore(pool);
  const orgId = dbKeyRow?.organization_id;
  const envId = dbKeyRow?.environment_id;
  const projId = dbKeyRow?.project_id;
  console.log(`orgId: ${orgId}, projId: ${projId}, envId: ${envId}`);

  if (orgId && envId) {
    await measure("PgConfigStore.loadCompiledByEnvironment", () => 
      store.loadCompiledByEnvironment(orgId, envId)
    );
  }

  console.log("\n--- STAGE 5: Entitlements & Subscriptions Queries ---");
  if (orgId) {
    await measure("redisLookupCache.getOrgEntitlementOverride", () => 
      redisLookupCache.getOrgEntitlementOverride(orgId)
    );
    await measure("entitlementsService.getEffectiveEntitlements", () => 
      entitlementsService.getEffectiveEntitlements(orgId)
    );
    await measure("entitlementsService.getSubscriptionState", () => 
      entitlementsService.getSubscriptionState(orgId)
    );
  }

  console.log("\n--- STAGE 6: Full buildDelivery execution ---");
  if (dbKeyRow) {
    const mapping = {
      organizationId: dbKeyRow.organization_id,
      projectId: dbKeyRow.project_id,
      defaultEnvironmentId: dbKeyRow.environment_id,
      allowedEnvironmentIds: [dbKeyRow.environment_id],
      keyId: dbKeyRow.key_id,
    };
    const service = new RemoteSdkConfigService(store, {
      topology: { ingestBaseUrl: "http://localhost:5000/api" },
    });
    await measure("service.buildDelivery (cold)", () => service.buildDelivery(mapping, {}));
  }

  await pool.end();
  await redis.quit();
  console.log("\n=== DETAILED PROFILER FINISHED ===");
}

run().catch((err) => {
  console.error("Profiler crashed:", err);
  pool.end();
  redis.quit();
});
