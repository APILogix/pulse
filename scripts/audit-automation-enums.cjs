require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(
    `SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname LIKE 'automation%' OR t.typname LIKE '%job_state%'
      GROUP BY t.typname ORDER BY t.typname`,
  );
  for (const row of r.rows) console.log(`${row.typname} = [${row.labels}]`);
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
