import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase, connectDB } from './config/database.js';
import { connectLogDB, logDB } from './config/log-database.js';
import { checkRedis, closeRedis, connectRedis } from './config/redis.js';
import { startPgBoss, stopPgBoss } from './lib/pgboss.js';
const bootLogger = logger.child({ component: 'bootstrap' });
// ── Memory Leak Prevention ─────────────────────────────────────────────
process.setMaxListeners(20);
const HEAP_CHECK_INTERVAL_MS = 60000;
const HEAP_GROWTH_THRESHOLD = 0.15; // 15% growth triggers warning
let lastHeapUsed = process.memoryUsage().heapUsed;
setInterval(() => {
    const current = process.memoryUsage();
    const growth = (current.heapUsed - lastHeapUsed) / lastHeapUsed;
    if (growth > HEAP_GROWTH_THRESHOLD) {
        bootLogger.warn({
            heapUsedMB: Math.round(current.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(current.heapTotal / 1024 / 1024),
            rssMB: Math.round(current.rss / 1024 / 1024),
            growthPercent: Math.round(growth * 100),
        }, 'Significant heap growth detected');
    }
    lastHeapUsed = current.heapUsed;
}, HEAP_CHECK_INTERVAL_MS).unref();
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
        await startPgBoss();
        const isRedisHealthy = await checkRedis();
        if (!isRedisHealthy) {
            bootLogger.fatal('Redis health check failed — aborting startup');
            process.exit(1);
        }
        bootLogger.info('All datastores connected');
        // ── Phase 2: Build application ────────────────────────────────────
        const app = await buildApp();
        // ── Phase 3: Graceful shutdown ────────────────────────────────────
        const SHUTDOWN_TIMEOUT_MS = 15000;
        const shutdown = async (signal) => {
            bootLogger.info({ signal }, 'Shutdown signal received — draining connections');
            const forceExitTimer = setTimeout(() => {
                bootLogger.fatal('Shutdown timeout exceeded — forcing exit');
                process.exit(1);
            }, SHUTDOWN_TIMEOUT_MS);
            forceExitTimer.unref();
            app.server.closeIdleConnections();
            app.server.closeAllConnections();
            await app.close();
            await closeRedis();
            await logDB.close();
            await closeDatabase();
            await stopPgBoss();
            clearTimeout(forceExitTimer);
            bootLogger.info('Shutdown complete');
            process.exit(0);
        };
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('unhandledRejection', (reason) => {
            bootLogger.fatal({ reason }, 'Unhandled promise rejection — shutting down');
            process.exit(1);
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
        bootLogger.info({
            port: env.PORT,
            host: env.HOST,
            env: env.NODE_ENV,
            pid: process.pid,
            memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        }, 'Server started successfully');
        // Signal PM2 that this worker is ready to accept connections.
        // In non-PM2 environments process.send is undefined — guard required.
        if (typeof process.send === 'function') {
            process.send('ready');
        }
    }
    catch (error) {
        bootLogger.fatal(error, 'Failed to start server');
        process.exit(1);
    }
}
bootstrap();
//# sourceMappingURL=main.js.map