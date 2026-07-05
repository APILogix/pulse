import { PgBoss } from 'pg-boss';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const bossLogger = logger.child({ component: 'pg-boss' });
const poolSize = env.INGESTION_DB_POOL_SIZE;
const connectionTimeoutMillis = env.INGESTION_DB_CONNECTION_TIMEOUT_MS;

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

/**
 * Enterprise PgBoss Singleton.
 * Uses its own connection pool for queueing and pub/sub to avoid 
 * exhausting the primary application query pool.
 */
export const pgboss = new PgBoss({
  connectionString: env.DATABASE_URL,
  application_name: `pgboss_${env.NODE_ENV}`,
  // Enterprise resiliency settings to prevent cloud load-balancer idle disconnects
  max: poolSize,
  connectionTimeoutMillis,
});

pgboss.on('error', (err: Error) => {
  bossLogger.error({ err }, 'PgBoss error');
});

pgboss.on('maintenance', () => {
  bossLogger.debug('PgBoss maintenance occurred');
});

type PgBossMonitorEmitter = {
  on(event: 'monitor', listener: (state: unknown) => void): void;
};

(pgboss as unknown as PgBossMonitorEmitter).on('monitor', (state: unknown) => {
  bossLogger.debug({ state }, 'PgBoss monitor event');
});

/**
 * Initializes the PgBoss instance (runs schema creation if missing).
 */
export async function startPgBoss(): Promise<void> {
  bossLogger.info({ poolSize, connectionTimeoutMillis }, 'Starting PgBoss...');
  await pgboss.start();
  bossLogger.info('PgBoss started successfully');
}

/**
 * Gracefully shuts down PgBoss.
 */
export async function stopPgBoss(): Promise<void> {
  bossLogger.info('Stopping PgBoss...');
  await pgboss.stop({ graceful: true, timeout: 10000 });
  bossLogger.info('PgBoss stopped');
}
