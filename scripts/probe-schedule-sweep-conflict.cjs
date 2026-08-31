/**
 * Probe: does the schedule sweep's inline INSERT ... ON CONFLICT (organization_id,
 * dedupe_key) WHERE organization_id IS NOT NULL DO NOTHING still resolve a REAL
 * duplicate correctly, now that 002_create_automation_runtime.sql created an
 * UNPARTITIONED UNIQUE (organization_id, dedupe_key) NULLS NOT DISTINCT index
 * (no predicate) instead of the partial index the sweep's WHERE clause implies?
 */
require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('BEGIN');
  try {
    const orgs = await c.query('SELECT id FROM organizations LIMIT 1');
    const orgId = orgs.rows[0].id;
    const dedupeKey = `probe-dup-${Date.now()}`;
    const sql = `INSERT INTO automation_events_inbox
         (organization_id, project_id, source_module, event_type, source_event_id, dedupe_key, payload, metadata)
       VALUES ($1,NULL,'automation','schedule.cron',$2,$2,$3::jsonb,$4::jsonb)
       ON CONFLICT (organization_id, dedupe_key) WHERE organization_id IS NOT NULL DO NOTHING
       RETURNING id`;
    const first = await c.query(sql, [orgId, dedupeKey, JSON.stringify({ n: 1 }), JSON.stringify({})]);
    const second = await c.query(sql, [orgId, dedupeKey, JSON.stringify({ n: 2 }), JSON.stringify({})]);
    console.log(`first insert returned ${first.rows.length} row(s)`);
    console.log(`second (duplicate) insert returned ${second.rows.length} row(s) -- should be 0`);
    const count = await c.query(
      `SELECT COUNT(*)::int AS n FROM automation_events_inbox WHERE organization_id=$1 AND dedupe_key=$2`,
      [orgId, dedupeKey],
    );
    console.log(`total rows with this dedupe_key: ${count.rows[0].n} -- should be 1`);
    console.log(second.rows.length === 0 && count.rows[0].n === 1 ? 'RESULT: DEDUP WORKS CORRECTLY' : 'RESULT: DEDUP IS BROKEN');
  } catch (e) {
    console.log('RESULT: statement FAILED ->', e.message);
  } finally {
    await c.query('ROLLBACK');
    await c.end();
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
