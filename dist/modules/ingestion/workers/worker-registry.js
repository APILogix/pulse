import { randomUUID } from 'crypto';
import { env } from '../../../config/env.js';
import { PgQueue, GENERAL_JOB_TYPES, SPECIALIZED_JOB_TYPES, } from '../queue/pg-queue.js';
import { PgQueueWorker } from '../queue/pg-queue-worker.js';
import { TelemetryWriter } from '../pipeline/telemetry-writer.js';
import { createIngestionJobHandler } from '../pipeline/ingestion-job-handler.js';
import { UsageCounter } from '../usage/usage-counter.js';
import { LogDatabase } from '../logging/log-database.js';
import { AdminLogger } from '../logging/admin-logger.js';
import { TelemetryMaintenanceWorker } from '../../../workers/telemetry-maintenance.processor.js';
export class WorkerRegistry {
    pool;
    log;
    queueName;
    generalQueue;
    specializedQueue;
    writer;
    usage;
    logDb;
    adminLogger;
    maintenance;
    generalPool = [];
    specializedPool = [];
    retryTimer = null;
    started = false;
    opts;
    constructor(pool, log, options = {}) {
        this.pool = pool;
        this.log = log;
        this.queueName = options.queue ?? 'ingestion';
        this.opts = {
            generalWorkers: options.generalWorkers ?? env.INGESTION_GENERAL_WORKERS,
            generalConcurrency: options.generalConcurrency ?? env.INGESTION_GENERAL_CONCURRENCY,
            generalBatchSize: options.generalBatchSize ?? env.INGESTION_GENERAL_BATCH_SIZE,
            specializedWorkers: options.specializedWorkers ?? env.INGESTION_SPECIALIZED_WORKERS,
            specializedConcurrency: options.specializedConcurrency ?? env.INGESTION_SPECIALIZED_CONCURRENCY,
            specializedBatchSize: options.specializedBatchSize ?? env.INGESTION_SPECIALIZED_BATCH_SIZE,
            visibilityTimeoutMs: options.visibilityTimeoutMs ?? env.INGESTION_VISIBILITY_TIMEOUT_MS,
            specializedVisibilityTimeoutMs: options.specializedVisibilityTimeoutMs ?? env.INGESTION_SPECIALIZED_VISIBILITY_TIMEOUT_MS,
            busyPollMs: options.busyPollMs ?? env.INGESTION_POLL_MS,
            idlePollMs: options.idlePollMs ?? env.INGESTION_IDLE_POLL_MS,
            retryIntervalMs: options.retryIntervalMs ?? env.INGESTION_RETRY_INTERVAL_MS,
            maintenanceIntervalMs: options.maintenanceIntervalMs ?? env.INGESTION_MAINTENANCE_INTERVAL_MS,
            completedRetentionMs: options.completedRetentionMs ?? env.INGESTION_COMPLETED_RETENTION_MS,
        };
        this.generalQueue = new PgQueue(this.pool, {
            queue: this.queueName,
            visibilityTimeoutMs: this.opts.visibilityTimeoutMs,
        });
        this.specializedQueue = new PgQueue(this.pool, {
            queue: this.queueName,
            visibilityTimeoutMs: this.opts.specializedVisibilityTimeoutMs,
        });
        this.writer = new TelemetryWriter(this.pool);
        this.logDb = new LogDatabase(this.log);
        this.usage = new UsageCounter(this.pool, this.log, {
            flushIntervalMs: env.INGESTION_USAGE_FLUSH_MS,
            bufferLimit: env.INGESTION_USAGE_BUFFER_LIMIT,
        });
        this.adminLogger = new AdminLogger(this.pool, this.logDb, this.log, {
            bufferSize: env.INGESTION_ADMIN_LOG_BUFFER_SIZE,
            flushIntervalMs: env.INGESTION_ADMIN_LOG_FLUSH_MS,
        });
        this.maintenance = new TelemetryMaintenanceWorker(this.pool, this.log, {
            intervalMs: this.opts.maintenanceIntervalMs,
        });
    }
    /** Construct + start every worker class. */
    async start() {
        if (this.started)
            return;
        this.started = true;
        await this.logDb.initialize();
        this.usage.start();
        this.adminLogger.start();
        const handler = createIngestionJobHandler(this.writer, this.usage);
        // 1) GENERAL workers — fast path, shared handler, per-worker maintenance
        //    disabled (the retry worker owns it).
        for (let i = 0; i < this.opts.generalWorkers; i++) {
            const w = new PgQueueWorker(this.generalQueue, handler, this.log, {
                workerId: this.workerId('general', i),
                workerType: 'general',
                jobTypes: GENERAL_JOB_TYPES,
                batchSize: this.opts.generalBatchSize,
                handlerConcurrency: this.opts.generalConcurrency,
                busyPollMs: this.opts.busyPollMs,
                idlePollMs: this.opts.idlePollMs,
                enableMaintenance: false,
            });
            w.start();
            this.generalPool.push(w);
        }
        // 2) SPECIALIZED workers — isolated heavy signals, longer lease.
        for (let i = 0; i < this.opts.specializedWorkers; i++) {
            const w = new PgQueueWorker(this.specializedQueue, handler, this.log, {
                workerId: this.workerId('specialized', i),
                workerType: 'specialized',
                jobTypes: SPECIALIZED_JOB_TYPES,
                batchSize: this.opts.specializedBatchSize,
                handlerConcurrency: this.opts.specializedConcurrency,
                busyPollMs: this.opts.busyPollMs,
                idlePollMs: this.opts.idlePollMs,
                enableMaintenance: false,
            });
            w.start();
            this.specializedPool.push(w);
        }
        // 3) RETRY worker — maintenance loop (no claiming).
        this.retryTimer = setInterval(() => void this.retryCycle(), this.opts.retryIntervalMs);
        this.retryTimer.unref?.();
        // 4) MAINTENANCE worker — partition automation + retention.
        this.maintenance.start();
        this.adminLogger.info('worker.lifecycle', 'Ingestion worker tier started', {
            workerId: `registry-${process.pid}`,
            metadata: {
                generalWorkers: this.opts.generalWorkers,
                specializedWorkers: this.opts.specializedWorkers,
            },
        });
        this.log.info({
            generalWorkers: this.opts.generalWorkers,
            generalConcurrency: this.opts.generalConcurrency,
            specializedWorkers: this.opts.specializedWorkers,
            specializedConcurrency: this.opts.specializedConcurrency,
            logDb: this.logDb.isEnabled(),
        }, 'WorkerRegistry started');
    }
    /**
     * Retry/maintenance cycle: recover expired leases, prune completed rows,
     * flush usage counters + admin logs, and report per-worker performance to the
     * logging database.
     */
    async retryCycle() {
        try {
            const recovered = await this.generalQueue.recoverStuck(500);
            const pruned = await this.generalQueue.pruneCompleted(this.opts.completedRetentionMs, 5000);
            if (recovered > 0 || pruned > 0) {
                this.adminLogger.debug('queue.maintenance', 'Recovery/prune cycle', {
                    metadata: { recovered, pruned },
                });
            }
        }
        catch (err) {
            this.log.error({ err }, 'Retry cycle maintenance failed');
        }
        // Usage + admin logs flush opportunistically (they also self-flush on their
        // own timers; this just tightens the window under load).
        void this.usage.flush();
        void this.adminLogger.flush();
        // Per-worker performance reporting to TimescaleDB.
        if (this.logDb.isEnabled()) {
            const all = [...this.generalPool, ...this.specializedPool];
            for (const w of all) {
                const s = w.drainStats();
                if (s.jobsProcessed === 0 && s.jobsFailed === 0)
                    continue;
                void this.logDb.writeWorkerPerformance({
                    workerId: s.workerId,
                    workerType: s.workerType,
                    jobsProcessed: s.jobsProcessed,
                    jobsFailed: s.jobsFailed,
                    avgDurationMs: s.avgDurationMs,
                    p95DurationMs: s.p95DurationMs,
                    pollCycles: s.pollCycles,
                });
            }
            // Queue-depth metric snapshot.
            void this.generalQueue
                .pendingDepth()
                .then((depth) => this.logDb.writeMetric('queue.pending_depth', depth))
                .catch(() => { });
        }
    }
    workerId(type, index) {
        return `${type}-${process.pid}-${index}-${randomUUID().slice(0, 8)}`;
    }
    /** Drain all workers and close logging resources. */
    async stop() {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }
        this.maintenance.stop();
        await Promise.all([
            ...this.generalPool.map((w) => w.stop()),
            ...this.specializedPool.map((w) => w.stop()),
        ]);
        await this.usage.stop();
        await this.adminLogger.stop();
        await this.logDb.end();
        this.log.info('WorkerRegistry stopped');
    }
}
//# sourceMappingURL=worker-registry.js.map