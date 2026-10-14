import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { PgmqClient } from './pgmq.js';
/**
 * Production PGMQ Consumer Worker.
 *
 * Implements robust at-least-once queue processing:
 * 1. Reads batches via `pgmq.readWithPoll` with configurable visibility timeout.
 * 2. Starts an automatic heartbeat loop (`set_vt`) for active long-running jobs.
 * 3. Enforces concurrency boundaries and settles each job individually.
 * 4. Acknowledges (`delete` or `archive`) upon successful processing.
 * 5. Automatically manages retry policy and dead-letter queue routing.
 * 6. Drains in-flight work safely upon receiving termination signals.
 */
export class PgmqWorker {
    queue;
    workerId;
    client;
    handler;
    log;
    batchSize;
    concurrency;
    visibilityTimeoutSeconds;
    pollTimeoutSeconds;
    pollIntervalMs;
    idlePollMs;
    maxIdlePollMs;
    busyPollMs;
    consecutiveEmptyPolls = 0;
    maxAttempts;
    deadLetterQueue;
    archiveOnComplete;
    heartbeatIntervalSeconds;
    drainTimeoutMs;
    onJobSuccess;
    onJobFailure;
    onMaxAttemptsExceeded;
    running = false;
    draining = false;
    inFlightJobs = new Map();
    processedCount = 0;
    failedCount = 0;
    deadLetteredCount = 0;
    retriedCount = 0;
    pollTimer = null;
    constructor(client, handler, options) {
        this.client = client;
        this.handler = handler;
        this.queue = options.queue;
        this.workerId = options.workerId ?? `${options.queue}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
        this.log = options.logger ?? logger.child({ component: 'pgmq-worker', queue: this.queue, workerId: this.workerId });
        this.batchSize = Math.max(1, options.batchSize ?? env.QUEUE_BATCH_SIZE ?? 50);
        this.concurrency = Math.max(1, options.concurrency ?? 5);
        this.visibilityTimeoutSeconds = Math.max(5, options.visibilityTimeoutSeconds ?? env.QUEUE_VISIBILITY_TIMEOUT_SECONDS ?? 60);
        this.pollTimeoutSeconds = Math.max(0, options.pollTimeoutSeconds ?? env.QUEUE_POLL_SECONDS ?? 2);
        this.pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 100);
        this.idlePollMs = Math.max(50, options.idlePollMs ?? 500);
        this.maxIdlePollMs = Math.max(this.idlePollMs, options.maxIdlePollMs ?? env.QUEUE_MAX_IDLE_POLL_MS ?? 5000);
        this.busyPollMs = Math.max(0, options.busyPollMs ?? 0);
        this.maxAttempts = Math.max(1, options.maxAttempts ?? env.QUEUE_MAX_ATTEMPTS ?? 5);
        this.deadLetterQueue = options.deadLetterQueue ?? null;
        this.archiveOnComplete = options.archiveOnComplete ?? false;
        this.heartbeatIntervalSeconds = Math.max(2, options.heartbeatIntervalSeconds ?? env.QUEUE_HEARTBEAT_INTERVAL_SECONDS ?? Math.floor(this.visibilityTimeoutSeconds / 3));
        this.drainTimeoutMs = Math.max(1000, options.drainTimeoutMs ?? env.QUEUE_DRAIN_TIMEOUT_MS ?? 30000);
        this.onJobSuccess = options.onJobSuccess;
        this.onJobFailure = options.onJobFailure;
        this.onMaxAttemptsExceeded = options.onMaxAttemptsExceeded;
    }
    /**
     * Starts the polling worker.
     */
    async start() {
        if (this.running)
            return;
        this.running = true;
        this.draining = false;
        // Ensure target queue and DLQ exist
        await this.client.createQueue(this.queue);
        if (this.deadLetterQueue) {
            await this.client.createQueue(this.deadLetterQueue);
        }
        this.log.info({
            queue: this.queue,
            batchSize: this.batchSize,
            concurrency: this.concurrency,
            vtSeconds: this.visibilityTimeoutSeconds,
            maxAttempts: this.maxAttempts,
            deadLetterQueue: this.deadLetterQueue,
        }, 'PGMQ worker started');
        void this.pollLoop();
    }
    getStats() {
        return {
            workerId: this.workerId,
            queue: this.queue,
            inFlight: this.inFlightJobs.size,
            processed: this.processedCount,
            failed: this.failedCount,
            deadLettered: this.deadLetteredCount,
            retried: this.retriedCount,
        };
    }
    async pollLoop() {
        if (!this.running || this.draining)
            return;
        let nextDelay = this.idlePollMs;
        try {
            const availableCapacity = this.concurrency - this.inFlightJobs.size;
            if (availableCapacity > 0) {
                const fetchQty = Math.min(this.batchSize, availableCapacity);
                const messages = (this.pollTimeoutSeconds === 0 && typeof this.client.read === 'function')
                    ? await this.client.read(this.queue, {
                        visibilityTimeoutSeconds: this.visibilityTimeoutSeconds,
                        quantity: fetchQty,
                    })
                    : await this.client.readWithPoll(this.queue, {
                        visibilityTimeoutSeconds: this.visibilityTimeoutSeconds,
                        quantity: fetchQty,
                        pollTimeoutSeconds: this.pollTimeoutSeconds || 1,
                        pollIntervalMs: this.pollIntervalMs,
                    });
                if (messages.length > 0) {
                    this.consecutiveEmptyPolls = 0;
                    nextDelay = this.busyPollMs;
                    // Spawn handlers for claimed messages concurrently up to capacity
                    for (const msg of messages) {
                        void this.executeJob(msg);
                    }
                }
                else {
                    // Adaptive backoff on empty poll to prevent connection pool exhaustion and idle loop thrashing
                    this.consecutiveEmptyPolls++;
                    const backoffMultiplier = Math.min(Math.pow(1.5, Math.min(this.consecutiveEmptyPolls, 6)), this.maxIdlePollMs / this.idlePollMs);
                    const baseDelay = Math.min(this.maxIdlePollMs, Math.round(this.idlePollMs * backoffMultiplier));
                    const jitter = Math.floor(Math.random() * Math.min(250, baseDelay * 0.15));
                    nextDelay = baseDelay + jitter;
                }
            }
            else {
                // At max concurrency, wait briefly before checking slots
                nextDelay = 50;
            }
        }
        catch (err) {
            this.consecutiveEmptyPolls++;
            this.log.error({ err }, 'Error during PGMQ worker poll cycle');
            nextDelay = Math.min(this.maxIdlePollMs, Math.max(this.idlePollMs, 1000));
        }
        if (this.running && !this.draining) {
            this.pollTimer = setTimeout(() => void this.pollLoop(), nextDelay);
            this.pollTimer.unref?.();
        }
    }
    async executeJob(job) {
        const abortController = new AbortController();
        let lastSuccessfulHeartbeatAt = Date.now();
        let consecutiveHeartbeatFailures = 0;
        const maxConsecutiveHeartbeatFailures = 3;
        const heartbeatTimeoutThresholdMs = this.visibilityTimeoutSeconds * 1000 * 0.75;
        // Setup heartbeat loop to extend VT during long task execution
        const heartbeatTimer = setInterval(async () => {
            try {
                await this.client.setVt(this.queue, job.msgId, this.visibilityTimeoutSeconds);
                lastSuccessfulHeartbeatAt = Date.now();
                consecutiveHeartbeatFailures = 0;
                this.log.debug({ msgId: job.msgId }, 'Extended visibility timeout via heartbeat');
            }
            catch (hbErr) {
                consecutiveHeartbeatFailures++;
                const elapsedSinceLastSuccess = Date.now() - lastSuccessfulHeartbeatAt;
                this.log.warn({
                    msgId: job.msgId,
                    err: hbErr instanceof Error ? hbErr.message : String(hbErr),
                    consecutiveFailures: consecutiveHeartbeatFailures,
                    elapsedMs: elapsedSinceLastSuccess,
                }, 'Heartbeat visibility extension failed');
                // Abort the running task if heartbeat is lost and visibility timeout is endangered
                // to prevent stale split-brain execution across multiple workers.
                if (consecutiveHeartbeatFailures >= maxConsecutiveHeartbeatFailures ||
                    elapsedSinceLastSuccess >= heartbeatTimeoutThresholdMs) {
                    this.log.error({ msgId: job.msgId, consecutiveFailures: consecutiveHeartbeatFailures, elapsedMs: elapsedSinceLastSuccess }, 'Heartbeat lost and visibility timeout endangered; aborting task execution to prevent split-brain');
                    abortController.abort(new Error('Heartbeat visibility timeout lost'));
                }
            }
        }, this.heartbeatIntervalSeconds * 1000);
        heartbeatTimer.unref?.();
        this.inFlightJobs.set(job.msgId, { job, heartbeatTimer, abortController });
        const startedAt = Date.now();
        try {
            // Check if job has exceeded max attempts (poison message guard)
            if (job.readCt > this.maxAttempts) {
                this.log.warn({ msgId: job.msgId, readCt: job.readCt, maxAttempts: this.maxAttempts }, 'Message exceeded max attempts — routing to dead-letter storage');
                await this.handleDeadLetter(job, new Error(`Exceeded max attempts (${job.readCt}/${this.maxAttempts})`));
                return;
            }
            // Execute application business handler
            await this.handler(job, abortController.signal);
            const durationMs = Date.now() - startedAt;
            // Successful completion: acknowledge and delete/archive message
            if (this.archiveOnComplete) {
                await this.client.archive(this.queue, job.msgId);
            }
            else {
                await this.client.delete(this.queue, job.msgId);
            }
            this.processedCount++;
            if (this.onJobSuccess) {
                await Promise.resolve(this.onJobSuccess(job, durationMs)).catch(() => { });
            }
        }
        catch (err) {
            const durationMs = Date.now() - startedAt;
            this.failedCount++;
            this.log.error({ msgId: job.msgId, err, durationMs }, 'Job processing failed in PGMQ worker');
            const isExhausted = job.readCt >= this.maxAttempts;
            if (isExhausted) {
                await this.handleDeadLetter(job, err);
            }
            else {
                this.retriedCount++;
                // Apply active exponential retry backoff with jitter so message retries promptly
                const baseBackoffSeconds = 2;
                const maxBackoffSeconds = 60;
                const exponent = Math.min(6, job.readCt);
                const jitterSeconds = Math.random() * 2;
                const backoffSeconds = Math.min(maxBackoffSeconds, Math.max(1, Math.round(baseBackoffSeconds * 2 ** (exponent - 1) + jitterSeconds)));
                try {
                    await this.client.setVt(this.queue, job.msgId, backoffSeconds);
                    this.log.debug({ msgId: job.msgId, attempt: job.readCt, backoffSeconds }, 'Applied active retry backoff');
                }
                catch (backoffErr) {
                    this.log.warn({ msgId: job.msgId, err: backoffErr }, 'Failed to set retry backoff; relying on natural VT expiry');
                }
                if (this.onJobFailure) {
                    await Promise.resolve(this.onJobFailure(job, err, true)).catch(() => { });
                }
            }
        }
        finally {
            clearInterval(heartbeatTimer);
            this.inFlightJobs.delete(job.msgId);
            // Trigger poll immediately if draining or if slots freed up
            if (this.running && !this.draining) {
                if (this.pollTimer)
                    clearTimeout(this.pollTimer);
                this.pollTimer = setTimeout(() => void this.pollLoop(), 0);
                this.pollTimer.unref?.();
            }
        }
    }
    async handleDeadLetter(job, error) {
        this.deadLetteredCount++;
        const dlqPayload = {
            sourceQueue: this.queue,
            originalMsgId: job.msgId,
            payload: job.message,
            error: error instanceof Error ? error.message : String(error),
            failedAt: new Date().toISOString(),
            attempts: job.readCt,
        };
        let client = null;
        try {
            if (typeof this.client.getCommandPool === 'function' && this.client.getCommandPool()) {
                client = await this.client.getCommandPool().connect();
                await client.query('BEGIN');
                if (this.deadLetterQueue) {
                    await this.client.send(this.deadLetterQueue, dlqPayload, {}, client);
                }
                await this.client.delete(this.queue, job.msgId, client);
                await client.query('COMMIT');
            }
            else {
                // Fallback for mocks or external custom client implementations
                if (this.deadLetterQueue) {
                    await this.client.send(this.deadLetterQueue, dlqPayload);
                }
                await this.client.delete(this.queue, job.msgId);
            }
            if (this.onMaxAttemptsExceeded) {
                await Promise.resolve(this.onMaxAttemptsExceeded(job, error)).catch(() => { });
            }
        }
        catch (dlqErr) {
            if (client) {
                await client.query('ROLLBACK').catch(() => { });
            }
            this.log.error({ msgId: job.msgId, err: dlqErr }, 'Failed to route message to DLQ');
        }
        finally {
            if (client) {
                client.release();
            }
        }
    }
    /**
     * Gracefully shuts down the worker:
     * 1. Stops accepting new messages.
     * 2. Waits for all active in-flight jobs to complete up to `drainTimeoutMs`.
     * 3. Aborts lingering jobs if deadline exceeded.
     */
    async stop() {
        if (!this.running && !this.draining)
            return;
        this.draining = true;
        this.running = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        this.log.info({ remainingJobs: this.inFlightJobs.size }, 'Draining PGMQ worker in-flight jobs...');
        const deadline = Date.now() + this.drainTimeoutMs;
        while (this.inFlightJobs.size > 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }
        // If deadline passed, abort remaining
        if (this.inFlightJobs.size > 0) {
            this.log.warn({ remainingJobs: this.inFlightJobs.size }, 'Drain deadline reached; aborting active workers');
            for (const [_, entry] of this.inFlightJobs) {
                clearInterval(entry.heartbeatTimer);
                entry.abortController.abort();
            }
        }
        this.inFlightJobs.clear();
        this.log.info('PGMQ worker stopped cleanly');
    }
}
//# sourceMappingURL=pgmq-worker.js.map