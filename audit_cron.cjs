const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();
  try {
    const cols = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'events_cron_checkins' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    console.log('=== COLUMNS ===');
    cols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type} | nullable=${r.is_nullable}`));

    const idx = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'events_cron_checkins' AND schemaname = 'public'
      ORDER BY indexname;
    `);
    console.log('\n=== INDEXES ===');
    idx.rows.forEach(r => console.log(`  ${r.indexname}\n    ${r.indexdef}`));

    const constrs = await client.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'events_cron_checkins'::regclass;
    `);
    console.log('\n=== CONSTRAINTS ===');
    constrs.rows.forEach(r => console.log(`  ${r.conname} (${r.contype}): ${r.def}`));

    const cnt = await client.query(`SELECT count(*) FROM events_cron_checkins;`);
    console.log(`\nROW COUNT: ${cnt.rows[0].count}`);
  } catch (err) {
    console.error(err.message);
  } finally {
    await client.end();
  }
}
main();
