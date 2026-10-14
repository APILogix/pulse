import { config } from 'dotenv';
import { Pool } from 'pg';
import '../src/config/dns.js';
import { resolvePostgresSslConfig, sanitizePostgresConnectionString } from '../src/config/postgres-ssl.js';

config();

async function main() {
  const url = process.env.LOG_DB_REPLICA;
  console.log('Testing replica URL:', url?.replace(/:([^:@]+)@/, ':****@'));
  if (!url) return;

  const pool = new Pool({
    connectionString: sanitizePostgresConnectionString(url),
    ssl: resolvePostgresSslConfig(url, {
      enabled: process.env.LOG_DB_SSL_ENABLED === 'true',
      rejectUnauthorized: process.env.LOG_DB_SSL_REJECT_UNAUTHORIZED === 'true',
    }),
  });

  try {
    const client = await pool.connect();
    console.log('Replica connected!');
    const res = await client.query('SELECT current_database(), version();');
    console.log('Replica result:', res.rows[0]);
    client.release();
  } catch (err: any) {
    console.error('Replica error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
