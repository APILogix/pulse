require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(
    `SELECT tpl.template_key,
            tv.definition->'trigger'->>'type' AS trigger_type,
            tv.definition->'conditions' AS conditions
       FROM automation_template_versions tv
       JOIN automation_templates tpl ON tpl.id = tv.template_id
      WHERE tpl.scope='platform' AND tpl.deleted_at IS NULL AND tv.is_current = TRUE
        AND tv.definition->'trigger'->>'sourceModule' = 'alerting'
      ORDER BY tpl.template_key`,
  );
  for (const row of r.rows) {
    console.log(`\n### ${row.template_key} (${row.trigger_type})`);
    console.log(JSON.stringify(row.conditions, null, 0));
  }
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
