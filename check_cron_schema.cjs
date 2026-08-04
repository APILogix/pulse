const { Client } = require('pg');
async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();
  try {
    const res = await client.query(`SELECT id, filename, applied_at FROM logdb_migrations ORDER BY id DESC LIMIT 5;`);
    console.log('Last 5 migrations:');
    res.rows.forEach(r => console.log(`  [${r.id}] ${r.filename} @ ${r.applied_at}`));

    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'events_cron_checkins' AND table_schema = 'public'
        AND column_name IN ('monitor_name','tenant_id','is_success','checkin_type','schedule_type','started_at','finished_at','tags','attributes')
      ORDER BY column_name;
    `);
    console.log('\nCanonical columns present:');
    cols.rows.forEach(r => console.log(`  ✓ ${r.column_name}`));
    const expected = ['monitor_name','tenant_id','is_success','checkin_type','schedule_type','started_at','finished_at','tags','attributes'];
    const found = cols.rows.map(r => r.column_name);
    const missing = expected.filter(c => !found.includes(c));
    if (missing.length) console.log(`\nMISSING: ${missing.join(', ')}`);
    else console.log('\nAll canonical columns present!');
  } catch(e) { console.error(e.message); }
  finally { await client.end(); }
}
main();
