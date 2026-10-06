import { pool, connectDB } from "../src/config/database.js";
import { connectRedis, redis } from "../src/config/redis.js";
import { buildApp } from "../src/app.js";
import { extractApiKeyPrefix } from "../src/modules/projects/shared/utils.js";
import { createHash } from "node:crypto";

async function run() {
  console.log("=== SDK INIT CORRECTNESS & SPEED BENCHMARK ===");
  await connectDB();
  await connectRedis();

  const app = await buildApp();
  await app.ready();

  // Find an active API key or check table
  const keyRes = await pool.query<{ id: string; public_key: string; project_id: string }>(
    `SELECT id, public_key, project_id FROM project_api_keys WHERE status = 'active' AND deleted_at IS NULL LIMIT 1`
  );

  console.log(`Found active API keys: ${keyRes.rowCount}`);
  if (keyRes.rowCount === 0) {
    console.log("No active API key in DB. Exiting test.");
    process.exit(0);
  }

  const row = keyRes.rows[0];
  console.log(`Testing with Public Key: ${row.public_key}, Project: ${row.project_id}`);

  // In project_api_keys, the raw key format is usually `${public_key}.${secret}`
  // Let's check how api keys are formatted
  console.log("Checking project_api_keys schema...");
  const sampleKey = await pool.query(`SELECT public_key, secret_hash FROM project_api_keys WHERE id = $1`, [row.id]);
  console.log("Row:", sampleKey.rows[0]);

  await app.close();
  await pool.end();
  await redis.quit();
}

run().catch(console.error);
