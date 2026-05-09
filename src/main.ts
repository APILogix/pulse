import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase, connectDB } from './config/database.js';
import { connectLogDB, logDB } from './config/log-database.js';
import { checkRedis, closeRedis, connectRedis } from './config/redis.js';

const bootLogger = logger.child({ component: 'bootstrap' });

/**
 * Application bootstrap sequence.
 *
 * Enterprise boot order:
 * 1. Connect ALL datastores (fail fast if any are unreachable)
 * 2. Build Fastify app (register plugins and modules)
 * 3. Start listening for HTTP traffic
 *
 * This ensures no HTTP request is ever accepted before all dependencies
 * are verified and ready.
 */
async function bootstrap() {
  try {
    // ── Phase 1: Verify datastore connectivity ────────────────────────
    bootLogger.info('Connecting to datastores');

    await connectDB();
    await connectLogDB();
    await connectRedis();

    const isRedisHealthy = await checkRedis();
    if (!isRedisHealthy) {
      bootLogger.fatal('Redis health check failed — aborting startup');
      process.exit(1);
    }

    bootLogger.info('All datastores connected');

    // ── Phase 2: Build application ────────────────────────────────────
    const app = await buildApp();

    // ── Phase 3: Graceful shutdown ────────────────────────────────────
    const shutdown = async (signal: string) => {
      bootLogger.info({ signal }, 'Shutdown signal received — draining connections');

      // Stop accepting new connections
      app.server.closeIdleConnections();

      // Close Fastify (triggers onClose hooks in registered modules)
      await app.close();

      // Close datastores in reverse order of dependency
      await closeRedis();
      await logDB.close();
      await closeDatabase();

      bootLogger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors that slip past Fastify
    process.on('unhandledRejection', (reason) => {
      bootLogger.fatal({ reason }, 'Unhandled promise rejection');
    });

    process.on('uncaughtException', (err) => {
      bootLogger.fatal({ err }, 'Uncaught exception — shutting down');
      process.exit(1);
    });

    // ── Phase 4: Start HTTP server ────────────────────────────────────
    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

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
  } catch (error) {
    bootLogger.fatal(error, 'Failed to start server');
    process.exit(1);
  }
}

bootstrap();
