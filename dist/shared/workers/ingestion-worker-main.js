/**
 * Ingestion worker process bootstrap (v3 tier).
 *
 * A dedicated OS process that drains the pg-boss ingestion queues and persists
 * telemetry. Kept SEPARATE from the API tier (PM2 cluster) so heavy
 * persistence work never steals CPU from request acceptance, and from the
 * general background-worker process (workers/main.ts) so the ingestion tier
 * can be scaled and tuned independently.
 *
 * Run with:
 *   npm run start:ingestion           (node dist/shared/workers/ingestion-worker-main.js)
 *   npm run dev:ingestion             (tsx watch src/shared/workers/ingestion-worker-main.ts)
 *
 * Horizontal scaling: run multiple copies. pg-boss hands each job to exactly
 * one worker across all processes/nodes, and idempotent inserts plus
 * retry-safe usage accounting make redelivery harmless.
 *
 * Process model:
 *   - One dedicated Postgres pool (max INGESTION_DB_POOL_SIZE,
 *     application_name='pulse_ingestion_workers') for persistence/usage/metrics.
 *   - The pg-boss singleton (its own pool) drives delivery.
 *   - One WorkerRegistry that owns the per-type worker pools, the tenant
 *     fairness gate, the DLQ intake worker, the usage-rollup cron and the
 *     metrics HTTP endpoint.
 *   - SIGTERM/SIGINT trigger a graceful drain (offWork waits for in-flight
 *     jobs, final usage flush, then pools close) before exit.
 */
import { Pool } from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { startPgBoss, stopPgBoss } from '../../lib/pgboss.js';
import { WorkerRegistry } from '../../modules/ingestion/workers/worker-registry.js';
const log = logger.child({ component: 'ingestion-worker-main' });
class IngestionWorkerProcess {
    pool = null;
    registry = null;
    shuttingDown = false;
    async start() {
        this.pool = new Pool({
            connectionString: env.DATABASE_URL,
            max: env.INGESTION_DB_POOL_SIZE,
            idleTimeoutMillis: env.INGESTION_DB_IDLE_TIMEOUT_MS,
            connectionTimeoutMillis: env.INGESTION_DB_CONNECTION_TIMEOUT_MS,
            application_name: `pulse_ingestion_workers_${env.NODE_ENV}`,
            keepAlive: true,
        });
        this.pool.on('error', (err) => log.error({ err }, 'Ingestion worker pool error (idle connection lost)'));
        // Fail fast if the database is unreachable at boot.
        await this.pool.query('SELECT 1');
        // pg-boss must be started before any work/schedule/send call.
        await startPgBoss();
        this.registry = new WorkerRegistry(this.pool, log);
        await this.registry.start();
        this.installSignalHandlers();
        // Signal readiness to a process supervisor (PM2 wait_ready), if listening.
        process.send?.('ready');
        log.info('Ingestion worker process started');
    }
    installSignalHandlers() {
        const onSignal = (signal) => {
            void this.shutdown(signal);
        };
        process.on('SIGTERM', () => onSignal('SIGTERM'));
        process.on('SIGINT', () => onSignal('SIGINT'));
        process.on('uncaughtException', (err) => {
            log.fatal({ err }, 'Uncaught exception in ingestion worker');
            void this.shutdown('uncaughtException', 1);
        });
        process.on('unhandledRejection', (reason) => {
            log.error({ reason }, 'Unhandled rejection in ingestion worker');
        });
    }
    async shutdown(signal, code = 0) {
        if (this.shuttingDown)
            return;
        this.shuttingDown = true;
        log.info({ signal }, 'Ingestion worker shutting down — draining');
        try {
            if (this.registry)
                await this.registry.stop();
            await stopPgBoss();
            if (this.pool)
                await this.pool.end();
        }
        catch (err) {
            log.error({ err }, 'Error during ingestion worker shutdown');
            code = code || 1;
        }
        finally {
            log.info('Ingestion worker shutdown complete');
            process.exit(code);
        }
    }
}
new IngestionWorkerProcess().start().catch((err) => {
    log.fatal({ err }, 'Failed to start ingestion worker process');
    process.exit(1);
});
//# sourceMappingURL=ingestion-worker-main.js.map