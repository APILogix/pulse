import './config/dns.js';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase, connectDB } from './config/database.js';
import { connectLogDB, logDB } from './config/log-database.js';
import { logProcessConnectionBudget } from './config/connection-budget.js';
import { retryConfiguredStartupOperation } from './config/startup-retry.js';
import { closeRedis, connectRedis } from './config/redis.js';
import { pgmq } from './lib/pgmq.js';
import { memoryDiagnostics } from './lib/memory-diagnostics.js';
// Multi-sample memory diagnostics monitoring
memoryDiagnostics.startMonitoring();
const bootLogger = logger.child({ component: 'bootstrap' });
let app = null;
let redisConnected = false;
let shutdownPromise = null;
async function closeStep(name, enabled, close) {
    if (!enabled)
        return;
    try {
        await close();
    }
    catch (error) {
        bootLogger.error({ err: error, resource: name }, 'Resource failed to close cleanly');
    }
}
/**
 * One idempotent drain path for signals, startup failures, and fatal errors.
 * Fastify stops accepting connections and drains in-flight requests before
 * queue/datastore clients are closed. A hard timeout remains as the final
 * safety net for a stuck dependency.
 */
function shutdown(reason, exitCode) {
    if (shutdownPromise)
        return shutdownPromise;
    shutdownPromise = (async () => {
        bootLogger.info({ reason, exitCode }, 'Shutting down — draining requests and resources');
        const forceExitTimer = setTimeout(() => {
            bootLogger.fatal({ reason }, 'Shutdown timeout exceeded — forcing exit');
            app?.server.closeAllConnections();
            process.exit(exitCode || 1);
        }, env.SHUTDOWN_TIMEOUT_MS);
        forceExitTimer.unref();
        await closeStep('http', app !== null, async () => {
            await app.close();
            app = null;
        });
        await closeStep('pgmq', true, async () => {
            await pgmq.close();
        });
        await closeStep('redis', redisConnected, async () => {
            await closeRedis();
            redisConnected = false;
        });
        await closeStep('log-database', true, async () => {
            await logDB.close();
        });
        await closeStep('database', true, async () => {
            await closeDatabase();
        });
        clearTimeout(forceExitTimer);
        memoryDiagnostics.stopMonitoring();
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
async function bootstrap() {
    try {
        bootLogger.info('Connecting to datastores');
        logProcessConnectionBudget('api', bootLogger);
        await retryConfiguredStartupOperation('primary database', connectDB, bootLogger);
        await retryConfiguredStartupOperation('log database', connectLogDB, bootLogger);
        try {
            await connectRedis();
            redisConnected = true;
            bootLogger.info('Redis lookup cache connected');
        }
        catch (redisErr) {
            if (env.REDIS_REQUIRED)
                throw redisErr;
            bootLogger.warn({ err: redisErr }, 'Redis connection failed during bootstrap (degrading cleanly to DB)');
        }
        bootLogger.info('All datastores connected');
        app = await buildApp();
        await app.listen({ port: env.PORT, host: env.HOST });
        bootLogger.info({
            port: env.PORT,
            host: env.HOST,
            env: env.NODE_ENV,
            pid: process.pid,
            memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        }, 'Server started successfully');
        memoryDiagnostics.markStartupComplete();
        if (typeof process.send === 'function')
            process.send('ready');
    }
    catch (error) {
        bootLogger.fatal({ err: error }, 'Failed to start server');
        await shutdown('startupFailure', 1);
    }
}
void bootstrap();
//# sourceMappingURL=main.js.map