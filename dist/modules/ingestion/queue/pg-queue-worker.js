import { PgQueue } from './pg-queue.js';
export class PgQueueWorker {
    queue;
    handler;
    log;
    running = false;
    draining = false;
    inFlight = 0;
    pollTimer = null;
    maintenanceTimer = null;
    workerId;
    workerType;
    batchSize;
    busyPollMs;
    idlePollMs;
    maintenanceMs;
    completedRetentionMs;
    handlerConcurrency;
    jobTypes;
    enableMaintenance;
    // Rolling stats since the last drainStats() call.
    jobsProcessed = 0;
    jobsFailed = 0;
    pollCycles = 0;
    durations = [];
    constructor(queue, handler, log, opts) {
        this.queue = queue;
        this.handler = handler;
        this.log = log;
        this.workerId = opts.workerId;
        this.workerType = opts.workerType ?? 'general';
        this.batchSize = opts.batchSize ?? 50;
        this.busyPollMs = opts.busyPollMs ?? 25;
        this.idlePollMs = opts.idlePollMs ?? 500;
        this.maintenanceMs = opts.maintenanceMs ?? 15_000;
        this.completedRetentionMs = opts.completedRetentionMs ?? 60 * 60_000;
        // Keep this well under the Postgres pool size so concurrent workers + their
        // in-flight handlers never exhaust connections.
        this.handlerConcurrency = opts.handlerConcurrency ?? 8;
        this.jobTypes = opts.jobTypes && opts.jobTypes.length > 0 ? opts.jobTypes : undefined;
        this.enableMaintenance = opts.enableMaintenance ?? true;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        this.log.info({ workerId: this.workerId, workerType: this.workerType }, 'PgQueueWorker started');
        void this.loop();
        if (this.enableMaintenance) {
            this.maintenanceTimer = setInterval(() => void this.maintenance(), this.maintenanceMs);
            // Don't keep the process alive solely for maintenance.
            this.maintenanceTimer.unref?.();
        }
    }
    /** Drain and reset rolling stats (called periodically for perf reporting). */
    drainStats() {
        const sorted = [...this.durations].sort((a, b) => a - b);
        const avg = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
        const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
        const stats = {
            workerId: this.workerId,
            workerType: this.workerType,
            jobsProcessed: this.jobsProcessed,
            jobsFailed: this.jobsFailed,
            pollCycles: this.pollCycles,
            avgDurationMs: Math.round(avg),
            p95DurationMs: Math.round(p95),
        };
        this.jobsProcessed = 0;
        this.jobsFailed = 0;
        this.pollCycles = 0;
        this.durations = [];
        return stats;
    }
    async loop() {
        if (!this.running)
            return;
        let nextDelay = this.idlePollMs;
        this.pollCycles++;
        try {
            const jobs = await this.queue.claim(this.workerId, this.batchSize, this.jobTypes);
            if (jobs.length > 0) {
                nextDelay = this.busyPollMs;
                // Process the claimed batch with BOUNDED concurrency. An unbounded
                // Promise.all over a large batch can open more DB connections than the
                // pool allows (pool max ~20), causing connection-timeout failures under
                // load. We cap in-flight handlers per poll cycle.
                await this.runBounded(jobs, this.handlerConcurrency);
            }
        }
        catch (err) {
            this.log.error({ err, workerId: this.workerId }, 'Poll cycle failed');
            nextDelay = this.idlePollMs;
        }
        if (this.running && !this.draining) {
            this.pollTimer = setTimeout(() => void this.loop(), nextDelay);
            this.pollTimer.unref?.();
        }
    }
    /** Run handlers over jobs with a bounded number in flight at once. */
    async runBounded(jobs, limit) {
        let cursor = 0;
        const runNext = async () => {
            while (cursor < jobs.length) {
                const job = jobs[cursor++];
                await this.process(job);
            }
        };
        const lanes = Array.from({ length: Math.min(limit, jobs.length) }, () => runNext());
        await Promise.all(lanes);
    }
    async process(job) {
        this.inFlight++;
        const startedAt = Date.now();
        try {
            await this.handler(job);
            const durationMs = Date.now() - startedAt;
            await this.queue.complete(job.id, { processedBy: this.workerId, durationMs });
            this.jobsProcessed++;
            this.durations.push(durationMs);
        }
        catch (err) {
            this.jobsFailed++;
            const msg = err instanceof Error ? err.message : String(err);
            const code = err instanceof Error ? err.name : undefined;
            try {
                const outcome = await this.queue.fail(job, msg, code);
                this.log.warn({ jobId: job.id, jobType: job.jobType, outcome, err: msg }, 'Job failed');
            }
            catch (failErr) {
                this.log.error({ jobId: job.id, err: failErr }, 'Failed to record job failure');
            }
        }
        finally {
            this.inFlight--;
        }
    }
    async maintenance() {
        try {
            await this.queue.recoverStuck(500);
            await this.queue.pruneCompleted(this.completedRetentionMs, 5000);
        }
        catch (err) {
            this.log.error({ err }, 'Queue maintenance cycle failed');
        }
    }
    /** Stop claiming new work and wait for in-flight jobs to settle. */
    async stop(timeoutMs = 15_000) {
        this.draining = true;
        this.running = false;
        if (this.pollTimer)
            clearTimeout(this.pollTimer);
        if (this.maintenanceTimer)
            clearInterval(this.maintenanceTimer);
        const deadline = Date.now() + timeoutMs;
        while (this.inFlight > 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }
        this.log.info({ workerId: this.workerId, remaining: this.inFlight }, 'PgQueueWorker stopped');
    }
}
//# sourceMappingURL=pg-queue-worker.js.map