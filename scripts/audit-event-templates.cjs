/**
 * Live inventory of every automation template's trigger, to verify (not assume)
 * which sourceModule values are event-based vs schedule-based, and which have a
 * real owning module today.
 */
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(
    `SELECT tpl.template_key, tpl.name,
            tv.definition->'trigger'->>'kind' AS trigger_kind,
            tv.definition->'trigger'->>'type' AS trigger_type,
            tv.definition->'trigger'->>'sourceModule' AS source_module,
            (SELECT string_agg(a->>'actionType', ' -> ')
               FROM jsonb_array_elements(COALESCE(tv.definition->'actions','[]'::jsonb)) a) AS actions
       FROM automation_template_versions tv
       JOIN automation_templates tpl ON tpl.id = tv.template_id
      WHERE tpl.scope = 'platform' AND tpl.deleted_at IS NULL AND tv.is_current = TRUE
      ORDER BY tv.definition->'trigger'->>'kind', tpl.template_key`,
  );
  console.log(`total platform templates: ${r.rows.length}\n`);
  const byKind = {};
  for (const row of r.rows) {
    byKind[row.trigger_kind] = (byKind[row.trigger_kind] || 0) + 1;
    console.log(`[${row.trigger_kind}] ${row.template_key.padEnd(45)} module=${(row.source_module ?? '-').padEnd(14)} type=${row.trigger_type ?? '-'}`);
    console.log(`    actions: ${row.actions}`);
  }
  console.log('\nby trigger kind:', JSON.stringify(byKind));

  const eventRows = r.rows.filter((x) => x.trigger_kind === 'event');
  const byModule = {};
  for (const row of eventRows) byModule[row.source_module] = (byModule[row.source_module] || 0) + 1;
  console.log('\nevent-triggered templates by sourceModule:', JSON.stringify(byModule));
  console.log(`\nTOTAL event-triggered templates: ${eventRows.length}`);
  console.log(`TOTAL alerting-sourced event templates: ${eventRows.filter((x) => x.source_module === 'alerting').length}`);

  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
