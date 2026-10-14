/**
 * Read-only dependency check before dropping the misplaced LOG DB automation
 * runtime stub tables. Confirms: row counts, inbound FKs, dependent views,
 * and any non-default indexes that might indicate real use.
 */
require('dotenv').config();
const { Client } = require('pg');

const TABLES = ['automation_runs', 'automation_run_steps', 'automation_events_inbox', 'automation_audit_logs'];

(async () => {
  const c = new Client({ connectionString: process.env.LOG_DB_PRIMARY, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('--- row counts (including partitions) ---');
  for (const t of TABLES) {
    const n = await c.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    console.log(`${t} = ${n.rows[0].n}`);
  }

  console.log('\n--- inbound foreign keys REFERENCING these tables ---');
  const fks = await c.query(
    `SELECT con.conname, src.relname AS referencing_table, tgt.relname AS referenced_table
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid
       JOIN pg_class tgt ON tgt.oid = con.confrelid
      WHERE con.contype = 'f' AND tgt.relname = ANY($1::text[])`,
    [TABLES],
  );
  console.log(fks.rows.length === 0 ? 'NONE' : JSON.stringify(fks.rows, null, 1));

  console.log('\n--- views/matviews depending on these tables ---');
  const views = await c.query(
    `SELECT DISTINCT dependent.relname AS dependent_object, dependent.relkind, src.relname AS source_table
       FROM pg_depend d
       JOIN pg_rewrite r ON r.oid = d.objid
       JOIN pg_class dependent ON dependent.oid = r.ev_class
       JOIN pg_class src ON src.oid = d.refobjid
      WHERE src.relname = ANY($1::text[]) AND dependent.relkind IN ('v','m')`,
    [TABLES],
  );
  console.log(views.rows.length === 0 ? 'NONE' : JSON.stringify(views.rows, null, 1));

  console.log('\n--- partitions attached ---');
  const parts = await c.query(
    `SELECT parent.relname AS parent, child.relname AS partition
       FROM pg_inherits i
       JOIN pg_class parent ON parent.oid = i.inhparent
       JOIN pg_class child ON child.oid = i.inhrelid
      WHERE parent.relname = ANY($1::text[]) ORDER BY 1,2`,
    [TABLES],
  );
  console.log(parts.rows.length === 0 ? 'NONE' : parts.rows.map((r) => `${r.parent} <- ${r.partition}`).join('\n'));

  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
