import pg from 'pg';
import { env } from './src/config/env.js';

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

async function check() {
  const res = await pool.query(`SELECT user_agent, browser_family, os_name, device_type FROM events_requests LIMIT 5`);
  console.log('Results:', res.rows);
  await pool.end();
}

check().catch(console.error);
