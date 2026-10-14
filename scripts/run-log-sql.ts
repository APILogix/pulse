import '../src/config/dns.js';
import { config } from 'dotenv';
config();
import { logDB } from '../src/config/log-database.js';

async function main() {
  const sql = process.argv.slice(2).join(' ');
  if (!sql) {
    console.log('No SQL provided');
    process.exit(1);
  }

  const pool = logDB.getPrimaryPool();
  const client = await pool.connect();
  try {
    const res = await client.query(sql);
    if (res.command === 'SELECT' || res.command === 'EXPLAIN') {
      console.log(JSON.stringify(res.rows, null, 2));
    } else {
      console.log(`${res.command} completed. Affected rows: ${res.rowCount}`);
    }
  } catch (err: any) {
    console.error('SQL Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await logDB.close();
  }
}

main();
