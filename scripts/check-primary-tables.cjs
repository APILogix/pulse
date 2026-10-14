const { Pool } = require('pg');
require('dotenv').config();

const primaryPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const logPool = new Pool({
  connectionString: process.env.LOG_DB_PRIMARY,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const pRes = await primaryPool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  const lRes = await logPool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");

  const pTables = new Set(pRes.rows.map(r => r.table_name));
  const lTables = new Set(lRes.rows.map(r => r.table_name));

  console.log('Tables in BOTH PrimaryDB and LogDB:');
  for (const t of pTables) {
    if (lTables.has(t)) {
      console.log(' - ' + t);
    }
  }

  await primaryPool.end();
  await logPool.end();
}

main().catch(err => {
  console.error(err);
  primaryPool.end();
  logPool.end();
});
