require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.LOG_DB_PRIMARY, ssl: { rejectUnauthorized: false } });
  await c.connect();
  // Try the smallest possible write to confirm this is a hard project-wide block.
  try {
    await c.query('CREATE TABLE _storage_probe (id int)');
    await c.query('DROP TABLE _storage_probe');
    console.log('trivial CREATE/DROP TABLE: SUCCEEDED (storage block may be transient or table-size-specific)');
  } catch (e) {
    console.log('trivial CREATE TABLE: FAILED ->', e.message);
  }
  // Check for dead tuple bloat that a non-destructive VACUUM could reclaim.
  const bloat = await c.query(`
    SELECT relname, n_dead_tup, n_live_tup
      FROM pg_stat_user_tables
     WHERE n_dead_tup > 10000
     ORDER BY n_dead_tup DESC LIMIT 10`);
  console.log('tables with significant dead-tuple bloat:', JSON.stringify(bloat.rows));
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
