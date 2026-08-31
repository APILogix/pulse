/**
 * Read-only automation schema audit.
 * Compares live PRIMARY DB automation tables against what the code requires.
 * Usage: node scripts/audit-automation-schema.cjs
 */
require('dotenv').config();
const { Client } = require('pg');

const TABLES = [
  'automation_workflows',
  'automation_workflow_versions',
  'automation_triggers',
  'automation_conditions',
  'automation_actions',
  'automation_approvals',
  'automation_templates',
  'automation_runs',
  'automation_run_steps',
  'automation_events_inbox',
  'automation_audit_logs',
];

async function inspect(label, connStr) {
  const c = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`\n=== ${label} ===`);
  const cols = await c.query(
    `SELECT table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`,
    [TABLES],
  );
  const byTable = new Map();
  for (const r of cols.rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
    byTable.get(r.table_name).push(r.column_name);
  }
  for (const t of TABLES) {
    if (!byTable.has(t)) {
      console.log(`  ${t}: MISSING`);
    } else {
      console.log(`  ${t}: ${byTable.get(t).length} cols -> ${byTable.get(t).join(', ')}`);
    }
  }
  // row counts for existing tables only
  for (const t of TABLES) {
    if (!byTable.has(t)) continue;
    try {
      const n = await c.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      console.log(`  COUNT ${t} = ${n.rows[0].n}`);
    } catch (e) {
      console.log(`  COUNT ${t} = ERROR ${e.message}`);
    }
  }
  await c.end();
}

(async () => {
  await inspect('PRIMARY (DATABASE_URL)', process.env.DATABASE_URL);
  await inspect('LOGDB (LOG_DB_PRIMARY)', process.env.LOG_DB_PRIMARY);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
