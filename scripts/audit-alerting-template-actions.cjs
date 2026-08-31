/**
 * Dump the full definition (trigger + conditions + actions) for the 6
 * alerting-sourced platform templates, so task #9 can design realistic
 * end-to-end payloads and know exactly which action types must actually
 * execute (and therefore which real side effect to assert on).
 */
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='automation_templates' ORDER BY ordinal_position`);
  console.log('automation_templates columns:', cols.rows.map((r) => r.column_name));
  const r = await c.query(`
    SELECT t.template_key, t.name, tv.definition
      FROM automation_templates t
      JOIN automation_template_versions tv ON tv.template_id = t.id AND tv.is_current = TRUE
     WHERE t.scope = 'platform'
       AND tv.definition->'trigger'->>'sourceModule' = 'alerting'
     ORDER BY t.template_key`);
  for (const row of r.rows) {
    console.log('='.repeat(80));
    console.log(row.template_key, '-', row.name);
    console.log(JSON.stringify(row.definition, null, 2));
  }
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
