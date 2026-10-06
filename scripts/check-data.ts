import { config } from 'dotenv';
config();
import { Pool } from 'pg';
import { resolvePostgresSslConfig, sanitizePostgresConnectionString } from '../src/config/postgres-ssl.js';

async function checkData() {
  const pPool = new Pool({
    connectionString: sanitizePostgresConnectionString(process.env.DATABASE_URL!),
    ssl: resolvePostgresSslConfig(process.env.DATABASE_URL!, { rejectUnauthorized: false })
  });

  const lPool = new Pool({
    connectionString: sanitizePostgresConnectionString(process.env.LOG_DB_PRIMARY!),
    ssl: false
  });

  console.log('=== PrimaryDB Data Audit ===');
  const pTablesRes = await pPool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  
  let pNonEmpty: { table: string; count: number }[] = [];
  let pTotalRows = 0;
  for (const { table_name } of pTablesRes.rows) {
    try {
      const cntRes = await pPool.query(`SELECT count(*)::int as count FROM "${table_name}"`);
      const cnt = cntRes.rows[0].count;
      if (cnt > 0) {
        pNonEmpty.push({ table: table_name, count: cnt });
        pTotalRows += cnt;
      }
    } catch (e) {}
  }
  console.log(`PrimaryDB: Total base tables: ${pTablesRes.rows.length}`);
  console.log(`PrimaryDB: Tables with data: ${pNonEmpty.length}`);
  pNonEmpty.forEach(t => console.log(`  - ${t.table}: ${t.count} rows`));
  console.log(`PrimaryDB: Total rows across all tables: ${pTotalRows}`);

  console.log('\n=== LogDB Data Audit ===');
  const lTablesRes = await lPool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  
  let lNonEmpty: { table: string; count: number }[] = [];
  let lTotalRows = 0;
  for (const { table_name } of lTablesRes.rows) {
    try {
      const cntRes = await lPool.query(`SELECT count(*)::int as count FROM "${table_name}"`);
      const cnt = cntRes.rows[0].count;
      if (cnt > 0) {
        lNonEmpty.push({ table: table_name, count: cnt });
        lTotalRows += cnt;
      }
    } catch (e) {}
  }
  console.log(`LogDB: Total base tables: ${lTablesRes.rows.length}`);
  console.log(`LogDB: Tables with data: ${lNonEmpty.length}`);
  lNonEmpty.forEach(t => console.log(`  - ${t.table}: ${t.count} rows`));
  console.log(`LogDB: Total rows across all tables: ${lTotalRows}`);

  await pPool.end();
  await lPool.end();
}

checkData().catch(console.error);
