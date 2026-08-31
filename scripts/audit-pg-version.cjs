require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const v = await c.query('SHOW server_version');
  console.log('PG_VERSION=' + v.rows[0].server_version);
  const f = await c.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE '%updated_at%'`,
  );
  console.log('UPDATED_AT_FNS=' + f.rows.map((r) => r.proname).join(',') || 'none');
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
