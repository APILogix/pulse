import { PgBoss } from 'pg-boss';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const bossLogger = logger.child({ component: 'pg-boss' });
const poolSize = env.INGESTION_DB_POOL_SIZE;
const connectionTimeoutMillis = env.INGESTION_DB_CONNECTION_TIMEOUT_MS;

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// API processes only publish durable jobs. Running pg-boss supervision and
// cron scheduling in every clustered API replica multiplies timers, database
// traffic, and maintenance work. Worker entrypoints retain the full runtime.
const entryPoint = process.argv[1] ?? '';
const inferredRole = /[\\/]shared[\\/]workers[\\/]/.test(entryPoint) ? 'worker' : 'api';
const processRole = process.env.PROCESS_ROLE ?? inferredRole;
const producerOnly = processRole === 'api';

/**
 * Enterprise PgBoss Singleton.
 * Uses its own connection pool so queue publishing cannot exhaust the primary
 * application query pool. API replicas run producer-only; worker processes own
 * scheduling, supervision, and job execution.
 */
export const pgboss = new PgBoss({
  connectionString: env.DATABASE_URL,
  application_name: `pgboss_${processRole}_${env.NODE_ENV}`,
  max: producerOnly ? Math.min(poolSize, 2) : poolSize,
  connectionTimeoutMillis,
  schedule: !producerOnly,
  supervise: !producerOnly,
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

let startPromise: Promise<void> | null = null;
let started = false;

/** Starts pg-boss once even when multiple modules request it concurrently. */
export async function startPgBoss(): Promise<void> {
  if (started) return;
  startPromise ??= (async () => {
    bossLogger.info(
      { poolSize: producerOnly ? Math.min(poolSize, 2) : poolSize, connectionTimeoutMillis, processRole, producerOnly },
      'Starting PgBoss',
    );
    await pgboss.start();
    started = true;
    bossLogger.info({ processRole, producerOnly }, 'PgBoss started successfully');
  })();
  try {
    await startPromise;
  } catch (error) {
    startPromise = null;
    throw error;
  }
}

/** Gracefully shuts down pg-boss without exceeding the process drain budget. */
export async function stopPgBoss(timeout = 10_000): Promise<void> {
  if (!startPromise) return;
  await startPromise.catch(() => undefined);
  if (!started) return;
  bossLogger.info({ timeout }, 'Stopping PgBoss');
  await pgboss.stop({ graceful: true, timeout });
  started = false;
  startPromise = null;
  bossLogger.info('PgBoss stopped');
}
