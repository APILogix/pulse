import { config } from 'dotenv';
config();
import { pool } from '../src/config/database.js';

async function main() {
  console.log('Testing Primary DB connection...');
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = await pool.connect();
      try {
        const res = await client.query('SELECT current_database(), version(), current_user;');
        console.log('Primary DB connected:', res.rows[0]);

        // Check table count
        const tableRes = await client.query(`
          SELECT count(*) as total_tables
          FROM information_schema.tables 
          WHERE table_schema = 'public';
        `);
        console.log('Public tables count:', tableRes.rows[0]);
      } finally {
        client.release();
      }
      await pool.end();
      return;
    } catch (err: any) {
      console.warn(`Primary DB attempt ${attempt}/${maxAttempts} failed:`, err.message);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      } else {
        console.error('Primary DB error after all attempts:', err.message);
        process.exit(1);
      }
    }
  }
}

main();
