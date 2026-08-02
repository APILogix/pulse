const { Client } = require('pg');
async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();
  try {
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'events_logs' AND table_schema = 'public'
        AND column_name IN ('parent_span_id','tenant_id','name','logger_name','log_source','log_category','endpoint','http_method','status_code','duration_ms','attributes')
      ORDER BY column_name;
    `);
    const expected = ['parent_span_id','tenant_id','name','logger_name','log_source','log_category','endpoint','http_method','status_code','duration_ms','attributes'];
    const found = cols.rows.map(r => r.column_name);
    const missing = expected.filter(c => !found.includes(c));
    if (missing.length) console.log(`\nMISSING: ${missing.join(', ')}`);
    else console.log('\nAll canonical log columns present!');
  } catch(e) { console.error(e.message); }
  finally { await client.end(); }
}
main();
