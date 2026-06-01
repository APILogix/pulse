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
    batchSize;
    busyPollMs;
    idlePollMs;
    maintenanceMs;
    completedRetentionMs;
    handlerConcurrency;
    constructor(queue, handler, log, opts) {
        this.queue = queue;
        this.handler = handler;
        this.log = log;
        this.workerId = opts.workerId;
        this.batchSize = opts.batchSize ?? 50;
        this.busyPollMs = opts.busyPollMs ?? 25;
        this.idlePollMs = opts.idlePollMs ?? 500;
        this.maintenanceMs = opts.maintenanceMs ?? 15_000;
        this.completedRetentionMs = opts.completedRetentionMs ?? 60 * 60_000;
        // Keep this well under the Postgres pool size so concurrent workers + their
        // in-flight handlers never exhaust connections.
        this.handlerConcurrency = opts.handlerConcurrency ?? 8;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        this.log.info({ workerId: this.workerId }, 'PgQueueWorker started');
        void this.loop();
        this.maintenanceTimer = setInterval(() => void this.maintenance(), this.maintenanceMs);
        // Don't keep the process alive solely for maintenance.
        this.maintenanceTimer.unref?.();
    }
    async loop() {
        if (!this.running)
            return;
        let nextDelay = this.idlePollMs;
        try {
            const jobs = await this.queue.claim(this.workerId, this.batchSize);
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
        try {
            await this.handler(job);
            await this.queue.complete(job.id);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
                const outcome = await this.queue.fail(job, msg);
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