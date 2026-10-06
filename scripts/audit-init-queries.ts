import { pool, connectDB } from "../src/config/database.js";
import { EFFECTIVE_ENTITLEMENTS_SQL } from "../src/modules/billing/entitlements/repository.js";

async function runExplain() {
  await connectDB();
  const publicKey = "pv_live_9039548f506985f832b42f16";
  const orgId = "5c67def8-2f5d-4358-b78d-59b7aa776059";
  const projId = "3606c81a-16bb-426b-a113-03fb17f80472";
  const envId = "8995b826-49be-45a0-ab39-729a05048b9a";

  console.log("=== 1. EXPLAIN ANALYZE API KEY LOOKUP ===");
  try {
    const q1 = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT p.org_id AS organization_id, 
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
      [publicKey]
    );
    console.log(q1.rows.map(r => r["QUERY PLAN"]).join("\n"));
  } catch (err: any) {
    console.error("Q1 error:", err.message);
  }

  console.log("\n=== 2. EXPLAIN ANALYZE LOAD COMPILED BY ENVIRONMENT ===");
  try {
    const q2 = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT r.revision_number, r.compiled_snapshot
         FROM project_environment_sdk_configs h
         JOIN project_environment_sdk_config_revisions r ON r.id = h.published_revision_id
         JOIN project_environments e
           ON e.id = h.environment_id AND e.project_id = h.project_id AND e.organization_id = h.organization_id
        WHERE h.organization_id = $1 AND h.environment_id = $2
          AND e.is_active = TRUE AND e.deleted_at IS NULL`,
      [orgId, envId]
    );
    console.log(q2.rows.map(r => r["QUERY PLAN"]).join("\n"));
  } catch (err: any) {
    console.error("Q2 error:", err.message);
  }

  console.log("\n=== 3. EXPLAIN ANALYZE LOAD COMPILED BY SDK METADATA ===");
  try {
    const q3 = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT r.revision_number, h.environment_id, r.compiled_snapshot
         FROM project_environment_sdk_configs h
         JOIN project_environment_sdk_config_revisions r ON r.id = h.published_revision_id
         JOIN projects p
           ON p.id = h.project_id AND p.org_id = h.organization_id
         JOIN project_environments e
           ON e.id = h.environment_id AND e.project_id = h.project_id AND e.organization_id = h.organization_id
        WHERE h.organization_id = $1
          AND h.project_id = $2
          AND e.slug = $3
          AND p.status = 'active' AND p.deleted_at IS NULL
          AND e.is_active = TRUE AND e.deleted_at IS NULL`,
      [orgId, projId, "production"]
    );
    console.log(q3.rows.map(r => r["QUERY PLAN"]).join("\n"));
  } catch (err: any) {
    console.error("Q3 error:", err.message);
  }

  console.log("\n=== 4. EXPLAIN ANALYZE SUBSCRIPTION STATE ===");
  try {
    const q4 = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT
          os.id AS "subscriptionId",
          os.plan_id AS "planId",
          p.key AS "planKey",
          p.tier AS "planTier",
          os.status,
          os.current_period_start AS "currentPeriodStart",
          os.current_period_end AS "currentPeriodEnd",
          os.cancel_at_period_end AS "cancelAtPeriodEnd"
        FROM organization_subscriptions os
        JOIN plans p ON p.id = os.plan_id
        WHERE os.organization_id = $1
          AND os.deleted_at IS NULL
          AND os.status IN ('trialing', 'active', 'past_due')
          AND os.current_period_end > NOW()
        ORDER BY
          CASE os.status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END,
          os.created_at DESC
        LIMIT 1`,
      [orgId]
    );
    console.log(q4.rows.map(r => r["QUERY PLAN"]).join("\n"));
  } catch (err: any) {
    console.error("Q4 error:", err.message);
  }

  console.log("\n=== 5. EXPLAIN ANALYZE EFFECTIVE ENTITLEMENTS ===");
  try {
    const q5 = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS)
       ${EFFECTIVE_ENTITLEMENTS_SQL}
       ORDER BY feature_key`,
      [orgId]
    );
    console.log(q5.rows.map(r => r["QUERY PLAN"]).join("\n"));
  } catch (err: any) {
    console.error("Q5 error:", err.message);
  }

  await pool.end();
}

runExplain().catch(console.error);
