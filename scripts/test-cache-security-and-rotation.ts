import { pool, connectDB } from "../src/config/database.js";
import { connectRedis, redis } from "../src/config/redis.js";
import { redisLookupCache } from "../src/db/redis/lookup-cache.js";
import { createApiKey } from "../src/modules/projects/shared/utils.js";
import { randomUUID } from "node:crypto";

async function main() {
  console.log("=== RUNNING SECURITY, TENANT ISOLATION & ROTATION AUDIT ===");
  await connectDB();
  await connectRedis();

  const projectId = "3606c81a-16bb-426b-a113-03fb17f80472";
  const orgId = "5c67def8-2f5d-4358-b78d-59b7aa776059";
  const envId = "8995b826-49be-45a0-ab39-729a05048b9a";

  // 1. Verify existing cached key has TTL = -1
  const ttl = await redisLookupCache.getRemoteConfigTtl(projectId);
  console.log(`[TEST 1] Persistent Remote Config TTL: ${ttl} (Expected: -1)`);
  if (ttl !== -1) throw new Error(`Expected TTL -1, got ${ttl}`);

  // 2. Create a secondary (rotated) active API key for the SAME project
  const genRotated = createApiKey("live");
  const rotatedKeyId = randomUUID();
  await pool.query(
    `INSERT INTO project_api_keys (
       id, project_id, organization_id, environment_id, name,
       public_key, secret_hash, status, is_active, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'Rotated Second Key', $5, $6, 'active', true, NOW(), NOW())`,
    [rotatedKeyId, projectId, orgId, envId, genRotated.publicKey, genRotated.secretHash]
  );
  console.log(`[TEST 2] Created rotated active API key: ${genRotated.fullKey}`);

  // Call /v1/init with rotated key via fetch
  const resRotated = await fetch("http://localhost:5000/v1/init", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": genRotated.fullKey,
    },
    body: JSON.stringify({}),
  });
  const dataRotated = await resRotated.json() as any;
  console.log(`[TEST 2 Status] ${resRotated.status} (Expected: 200)`);
  console.log(`[TEST 2 Project] ${dataRotated.projectId} (Expected: ${projectId})`);
  if (resRotated.status !== 200 || dataRotated.projectId !== projectId) {
    throw new Error("Rotated key failed to access project configuration!");
  }

  // 3. Create a REVOKED API key
  const genRevoked = createApiKey("live");
  const revokedKeyId = randomUUID();
  await pool.query(
    `INSERT INTO project_api_keys (
       id, project_id, organization_id, environment_id, name,
       public_key, secret_hash, status, is_active, revoked_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'Revoked Test Key', $5, $6, 'revoked', false, NOW(), NOW(), NOW())`,
    [revokedKeyId, projectId, orgId, envId, genRevoked.publicKey, genRevoked.secretHash]
  );
  console.log(`[TEST 3] Created revoked key: ${genRevoked.fullKey}`);

  const resRevoked = await fetch("http://localhost:5000/v1/init", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": genRevoked.fullKey,
    },
    body: JSON.stringify({}),
  });
  console.log(`[TEST 3 Status] ${resRevoked.status} (Expected: 401)`);
  if (resRevoked.status !== 401) {
    throw new Error(`Expected 401 for revoked key, got ${resRevoked.status}`);
  }

  // 4. Test INVALID / FAKE API key
  const fakeKey = "pv_live_000000000000000000000000.ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const resFake = await fetch("http://localhost:5000/v1/init", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": fakeKey,
    },
    body: JSON.stringify({}),
  });
  console.log(`[TEST 4 Status] ${resFake.status} (Expected: 401)`);
  if (resFake.status !== 401) {
    throw new Error(`Expected 401 for fake key, got ${resFake.status}`);
  }

  // Clean up test keys
  await pool.query(`DELETE FROM project_api_keys WHERE id IN ($1, $2)`, [rotatedKeyId, revokedKeyId]);
  console.log("Cleaned up test keys.");

  await pool.end();
  await redis.quit();
  console.log("=== SECURITY, TENANT ISOLATION & ROTATION AUDIT PASSED! ===");
}

main().catch(console.error);
