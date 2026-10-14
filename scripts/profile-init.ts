import { pool, connectDB } from "../src/config/database.js";
import { connectRedis, redis } from "../src/config/redis.js";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

async function profile() {
  console.log("=== STARTING FULL /init STAGE-BY-STAGE PROFILE ===");
  await connectDB();
  await connectRedis();

  // 1. Measure Redis PING latency
  const t0 = performance.now();
  const pong = await redis.ping();
  const redisPingMs = performance.now() - t0;
  console.log(`[Redis Ping] ${pong} in ${redisPingMs.toFixed(2)}ms`);

  // 2. Find an active API key
  const keyRes = await pool.query<{
    id: string;
    project_id: string;
    environment_id: string;
    public_key: string;
    secret_hash: string;
  }>(
    `SELECT k.id, k.project_id, k.environment_id, k.public_key, k.secret_hash
       FROM project_api_keys k
       JOIN projects p ON p.id = k.project_id
      WHERE k.status = 'active'
        AND (k.is_active IS NULL OR k.is_active = TRUE)
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
        AND (p.status IS NULL OR p.status = 'active')
        AND k.deleted_at IS NULL
      LIMIT 5`
  );

  console.log(`Found ${keyRes.rows.length} active API keys`);
  if (keyRes.rows.length === 0) {
    console.log("No active keys found!");
    return;
  }

  for (const k of keyRes.rows) {
    console.log(`Key ID: ${k.id}, public_key: ${k.public_key}, project_id: ${k.project_id}`);
  }

  // To test an actual API key, we need the secret suffix or we can create a temporary test key
  // Let's create a known test key for the project if needed, or check if any raw key is saved in scratch or test
}

profile().catch(console.error).finally(() => {
  pool.end();
  redis.quit();
});
