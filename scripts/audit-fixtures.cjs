require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const t of ['users', 'organizations', 'projects']) {
    const n = await c.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    console.log(`${t} = ${n.rows[0].n}`);
  }
  const o = await c.query('SELECT id, name, slug, owner_user_id FROM organizations LIMIT 3');
  console.log('orgs:', JSON.stringify(o.rows));
  const u = await c.query('SELECT id, email FROM users LIMIT 3');
  console.log('users:', JSON.stringify(u.rows));
  const p = await c.query('SELECT id, org_id, name FROM projects LIMIT 3');
  console.log('projects:', JSON.stringify(p.rows));
  const req = await c.query(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_name='organizations' AND is_nullable='NO' AND column_default IS NULL`,
  );
  console.log('org required cols:', req.rows.map((r) => r.column_name).join(','));
  const ureq = await c.query(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_name='users' AND is_nullable='NO' AND column_default IS NULL`,
  );
  console.log('user required cols:', ureq.rows.map((r) => r.column_name).join(','));
  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
