import { Pool } from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,                    // Max connections
  min: 5,                     // Keep warm
  idleTimeoutMillis: 30000,   // Close idle after 30s
  connectionTimeoutMillis: 5000,
  
  // Performance
statement_timeout: 10000, // enforce at DB level (real protection)
query_timeout: 10000,     // backup at client level
});

pool.on('error', (err: any) => {
  logger.error({ err }, 'Unexpected PostgreSQL error');
});

export const closeDatabase = async () => {
  await pool.end();
};

// Query helper with logging
export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  
  logger.debug({ query: text.slice(0, 100), duration, rows: result.rowCount });
  
  return result;
};