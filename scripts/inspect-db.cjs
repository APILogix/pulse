const { Pool } = require('pg');
require('dotenv').config();

const targetDb = process.argv.includes('--primary') ? process.env.DATABASE_URL : (process.env.LOG_DB_PRIMARY || process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: targetDb,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const isPrimary = process.argv.includes('--primary');
  const pattern = process.argv.slice(2).find(a => !a.startsWith('--'));

  if (pattern) {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name LIKE $1
      ORDER BY table_name;
    `, [`%${pattern}%`]);

    console.log(`=== [${isPrimary ? 'PrimaryDB' : 'LogDB'}] TABLES MATCHING "${pattern}" ===`);
    console.log(res.rows.map(r => r.table_name));

    if (res.rows.length === 1 || res.rows.some(r => r.table_name === pattern)) {
      const target = res.rows.some(r => r.table_name === pattern) ? pattern : res.rows[0].table_name;
      const cols = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [target]);
      const idxs = await pool.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY indexname;
      `, [target]);
      console.log(`\nColumns for [${target}]:`);
      console.log(cols.rows);
      console.log(`\nIndexes for [${target}]:`);
      console.log(idxs.rows);
    }
  }
  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
});
