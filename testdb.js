import { config } from 'dotenv';
import './src/config/dns.js';
import pg from 'pg';
import {
  getSafePostgresConnectionMetadata,
  parsePostgresAddressFamily,
  withPostgresAddressFamily,
} from './src/config/postgres-network.js';
import {
  resolvePostgresSslConfig,
  sanitizePostgresConnectionString,
} from './src/config/postgres-ssl.js';

const { Pool } = pg;
config({ quiet: true });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const family = parsePostgresAddressFamily(process.env.DB_FAMILY);
const ssl = resolvePostgresSslConfig(connectionString, {
  enabled: process.env.DB_SSL_ENABLED !== undefined ? process.env.DB_SSL_ENABLED === 'true' : undefined,
  rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== undefined ? process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' : undefined,
});
const pool = new Pool(withPostgresAddressFamily({
  connectionString: sanitizePostgresConnectionString(connectionString),
  ssl,
  max: 1,
  min: 0,
  connectionTimeoutMillis: 30_000,
}, family));

console.log('PostgreSQL connectivity test', getSafePostgresConnectionMetadata(connectionString, {
  family,
  ssl,
  poolMax: 1,
  poolMin: 0,
}));

const maxAttempts = 3;

try {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await pool.query('SELECT 1 AS ok;');
      console.log('PostgreSQL connection succeeded', { ok: result.rows[0]?.ok === 1, attempt });
      break;
    } catch (error) {
      console.warn(`Connection attempt ${attempt}/${maxAttempts} failed:`, error instanceof Error ? error.message : String(error));
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      } else {
        console.error('PostgreSQL connection failed after all attempts', {
          code: error instanceof Error && 'code' in error ? error.code : undefined,
          message: error instanceof Error ? error.message : String(error),
        });
        process.exitCode = 1;
      }
    }
  }
} finally {
  await pool.end();
}
