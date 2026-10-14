import { performance } from "node:perf_hooks";
import { pool } from "../src/config/database.js";
import { redisLookupCache } from "../src/db/redis/lookup-cache.js";
import { extractApiKeyPrefix } from "../src/modules/projects/shared/utils.js";
import { redis } from "../src/config/redis.js";

const API_KEY = "pv_live_c78781a83084d4fffe63fac1.3e47fdaec683c36b27b9b04aad0a1b42673c290011a966463f8e6de872ab3730";

async function main() {
  console.log("=== Testing Individual Components ===");
  console.log("Redis status:", redis.status);

  // 1. isKeyNegativeCached
  let t0 = performance.now();
  const isNeg = await redisLookupCache.isKeyNegativeCached(API_KEY);
  console.log(`1. isKeyNegativeCached: ${(performance.now() - t0).toFixed(1)}ms (result: ${isNeg})`);

  // 2. getApiKeyMapping
  t0 = performance.now();
  const cached = await redisLookupCache.getApiKeyMapping(API_KEY);
  console.log(`2. getApiKeyMapping: ${(performance.now() - t0).toFixed(1)}ms (result: ${!!cached})`);

  // 3. PostgreSQL query
  const publicKey = extractApiKeyPrefix(API_KEY);
  console.log("Extracted publicKey:", publicKey);

  t0 = performance.now();
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
  console.log(`3. pool.query: ${(performance.now() - t0).toFixed(1)}ms (rows: ${result.rows.length})`);

  // 4. Test pool.query multiple times
  for (let i = 1; i <= 3; i++) {
    t0 = performance.now();
    await pool.query(
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
    console.log(`3.${i} repeat pool.query: ${(performance.now() - t0).toFixed(1)}ms`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Diagnostic error:", err);
  process.exit(1);
});
