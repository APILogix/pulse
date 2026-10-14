import { pool, connectDB } from "../src/config/database.js";
import { createApiKey } from "../src/modules/projects/shared/utils.js";
import { randomUUID } from "node:crypto";

async function main() {
  await connectDB();

  // Find active project and environment
  const envRes = await pool.query<{
    id: string;
    project_id: string;
    organization_id: string;
    slug: string;
  }>(
    `SELECT e.id, e.project_id, e.organization_id, e.slug 
       FROM project_environments e
       JOIN projects p ON p.id = e.project_id
      WHERE e.deleted_at IS NULL AND p.deleted_at IS NULL
      LIMIT 1`
  );

  if (envRes.rows.length === 0) {
    console.error("No active environment found!");
    return;
  }

  const envRow = envRes.rows[0];
  console.log("Using env:", envRow);

  // Check if our benchmark key already exists
  const existing = await pool.query<{ id: string; public_key: string }>(
    `SELECT id, public_key FROM project_api_keys WHERE name = 'Benchmark Test Key' AND deleted_at IS NULL LIMIT 1`
  );

  let fullKey: string;
  if (existing.rows.length > 0) {
    console.log("Re-generating benchmark key with known secret...");
    const gen = createApiKey(envRow.slug || "live");
    fullKey = gen.fullKey;
    await pool.query(
      `UPDATE project_api_keys 
          SET public_key = $1, secret_hash = $2, status = 'active', is_active = true, updated_at = NOW()
        WHERE id = $3`,
      [gen.publicKey, gen.secretHash, existing.rows[0].id]
    );
    console.log("Updated benchmark key. fullKey:", fullKey);
  } else {
    const gen = createApiKey(envRow.slug || "live");
    fullKey = gen.fullKey;
    const id = randomUUID();
    await pool.query(
      `INSERT INTO project_api_keys (
         id, project_id, organization_id, environment_id, name,
         public_key, secret_hash, status, is_active, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'Benchmark Test Key', $5, $6, 'active', true, NOW(), NOW())`,
      [id, envRow.project_id, envRow.organization_id, envRow.id, gen.publicKey, gen.secretHash]
    );
    console.log("Inserted new benchmark key. fullKey:", fullKey);
  }

  await pool.end();
}

main().catch(console.error);
