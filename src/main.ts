import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase, connectDB } from './config/database.js';
import { connectLogDB, logDB } from './config/log-database.js';
import { checkRedis, closeRedis, connectRedis } from './config/redis.js';
import { startPgBoss, stopPgBoss } from './lib/pgboss.js';

const bootLogger = logger.child({ component: 'bootstrap' });

const HEAP_CHECK_INTERVAL_MS = 60_000;
const HEAP_GROWTH_THRESHOLD = 0.15;
let lastHeapUsed = process.memoryUsage().heapUsed;

setInterval(() => {
  const current = process.memoryUsage();
  const growth = lastHeapUsed > 0 ? (current.heapUsed - lastHeapUsed) / lastHeapUsed : 0;
  if (growth > HEAP_GROWTH_THRESHOLD) {
    bootLogger.warn(
      {
        heapUsedMB: Math.round(current.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(current.heapTotal / 1024 / 1024),
        rssMB: Math.round(current.rss / 1024 / 1024),
        growthPercent: Math.round(growth * 100),
      },
      'Significant heap growth detected',
    );
  }
  lastHeapUsed = current.heapUsed;
}, HEAP_CHECK_INTERVAL_MS).unref();

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | null = null;
let databaseConnected = false;
let logDatabaseConnected = false;
let redisConnected = false;
let pgBossStarted = false;
let shutdownPromise: Promise<void> | null = null;

async function closeStep(name: string, enabled: boolean, close: () => Promise<void>): Promise<void> {
  if (!enabled) return;
  try {
    await close();
  } catch (error) {
    bootLogger.error({ err: error, resource: name }, 'Resource failed to close cleanly');
  }
}

/**
 * One idempotent drain path for signals, startup failures, and fatal errors.
 * Fastify stops accepting connections and drains in-flight requests before
 * queue/datastore clients are closed. A hard timeout remains as the final
 * safety net for a stuck dependency.
 */
function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    bootLogger.info({ reason, exitCode }, 'Shutting down — draining requests and resources');

    const forceExitTimer = setTimeout(() => {
      bootLogger.fatal({ reason }, 'Shutdown timeout exceeded — forcing exit');
      app?.server.closeAllConnections();
      process.exit(exitCode || 1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    await closeStep('http', app !== null, async () => {
      await app!.close();
      app = null;
    });
    await closeStep('pg-boss', pgBossStarted, async () => {
      await stopPgBoss(Math.min(10_000, env.SHUTDOWN_TIMEOUT_MS));
      pgBossStarted = false;
    });
    await closeStep('redis', redisConnected, async () => {
      await closeRedis();
      redisConnected = false;
    });
    await closeStep('log-database', logDatabaseConnected, async () => {
      await logDB.close();
      logDatabaseConnected = false;
    });
    await closeStep('database', databaseConnected, async () => {
      await closeDatabase();
      databaseConnected = false;
    });

    clearTimeout(forceExitTimer);
    bootLogger.info({ reason, exitCode }, 'Shutdown complete');
    process.exit(exitCode);
  })();

  return shutdownPromise;
}

process.once('SIGTERM', () => void shutdown('SIGTERM', 0));
process.once('SIGINT', () => void shutdown('SIGINT', 0));
process.once('unhandledRejection', (reason) => {
  bootLogger.fatal({ reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
process.once('uncaughtException', (err) => {
  bootLogger.fatal({ err }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});

/** Connect dependencies, construct Fastify, then begin accepting traffic. */
async function bootstrap(): Promise<void> {
  try {
    bootLogger.info('Connecting to datastores');

    await connectDB();
    databaseConnected = true;
    await connectLogDB();
    logDatabaseConnected = true;
    await connectRedis();
    redisConnected = true;
    await startPgBoss();
    pgBossStarted = true;

    if (!(await checkRedis())) {
      throw new Error('Redis health check failed');
    }

    bootLogger.info('All datastores connected');
    app = await buildApp();

    await app.listen({ port: env.PORT, host: env.HOST });

    bootLogger.info(
      {
        port: env.PORT,
        host: env.HOST,
        env: env.NODE_ENV,
        pid: process.pid,
        memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      'Server started successfully',
    );

    if (typeof process.send === 'function') process.send('ready');
  } catch (error) {
    bootLogger.fatal({ err: error }, 'Failed to start server');
    await shutdown('startupFailure', 1);
  }
}

void bootstrap();
