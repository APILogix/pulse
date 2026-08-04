const { Client } = require('pg');
async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();
  try {
    const res = await client.query(`SELECT id, filename, applied_at FROM logdb_migrations ORDER BY id DESC LIMIT 10;`);
    console.log('Last 10 migrations:');
    res.rows.forEach(r => console.log(`  [${r.id}] ${r.filename} @ ${r.applied_at}`));

    // Check if new columns exist
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'events_metrics' AND table_schema = 'public'
        AND column_name IN ('metric_unit','metric_namespace','metric_description','metric_category','aggregation_type','temporality','is_monotonic','tenant_id','http_method')
      ORDER BY column_name;
    `);
    console.log('\nCanonical columns present:');
    cols.rows.forEach(r => console.log(`  ✓ ${r.column_name}`));
    const expected = ['metric_unit','metric_namespace','metric_description','metric_category','aggregation_type','temporality','is_monotonic','tenant_id','http_method'];
    const found = cols.rows.map(r => r.column_name);
    const missing = expected.filter(c => !found.includes(c));
    if (missing.length) console.log(`\nMISSING: ${missing.join(', ')}`);
    else console.log('\nAll canonical columns present!');
  } catch(e) { console.error(e.message); }
  finally { await client.end(); }
}
main();
