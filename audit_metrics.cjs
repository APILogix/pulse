const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();
  try {
    // Get all columns for events_metrics
    const cols = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'events_metrics'
        AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    console.log('=== events_metrics COLUMNS ===');
    cols.rows.forEach(r => console.log(`  ${r.column_name} | ${r.data_type} | nullable=${r.is_nullable}`));

    // Get all indexes on events_metrics (including partitions)
    const idxs = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'events_metrics'
        AND schemaname = 'public'
      ORDER BY indexname;
    `);
    console.log('\n=== events_metrics INDEXES ===');
    idxs.rows.forEach(r => console.log(`  ${r.indexname}\n    ${r.indexdef}`));

    // Get constraints
    const constrs = await client.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'events_metrics'::regclass;
    `);
    console.log('\n=== events_metrics CONSTRAINTS ===');
    constrs.rows.forEach(r => console.log(`  ${r.conname} (${r.contype}): ${r.def}`));

    // Get row count
    const cnt = await client.query(`SELECT count(*) FROM events_metrics;`);
    console.log(`\n=== Row Count: ${cnt.rows[0].count} ===`);
  } catch (err) {
    console.error(err.message);
  } finally {
    await client.end();
  }
}
main();
