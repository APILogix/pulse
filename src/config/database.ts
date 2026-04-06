import { Pool } from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';

if (!env.DATABASE_URL) {
  throw new Error(' DATABASE_URL is not set');
}

logger.info(' Initializing PostgreSQL connection pool');

export const pool = new Pool({
  connectionString: env.DATABASE_URL,

  max: 20,
  min: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,

  statement_timeout: 10000,
  query_timeout: 10000,
});

// 🔹 Pool Events (visibility = power)
pool.on('connect', () => {
  console.log(' New DB connection established');
});

pool.on('acquire', () => {
  console.log(' Connection acquired from pool');
});

pool.on('remove', () => {
  console.log(' Connection removed');
});

pool.on('error', (err: any) => {
  logger.error({ err }, ' Unexpected PostgreSQL error');
});

// 🔹 Test connection on startup (FAIL FAST)
export const connectDB = async () => {
  try {
    const client = await pool.connect();

    const res = await client.query('SELECT NOW()');
    console.log(' Database connected successfully');
    console.log(' DB Time:', res.rows[0]);

    client.release();
  } catch (err) {
    console.error(' Failed to connect to database:', err);
    process.exit(1); // crash app if DB fails (important)
  }
};

// 🔹 Query helper
export const query = async (text: string, params?: any[]) => {
  const start = Date.now();

  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    logger.debug({
      query: text.slice(0, 100),
      duration,
      rows: result.rowCount,
    });

    return result;
  } catch (err) {
    logger.error({ err, query: text }, '❌ Query failed');
    throw err;
  }
};

// 🔹 Graceful shutdown
export const closeDatabase = async () => {
  console.log(' Closing DB pool...');
  await pool.end();
};