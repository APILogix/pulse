export class AdminLogger {
    pool;
    logDb;
    log;
    buffer = [];
    bufferSize;
    flushIntervalMs;
    timer = null;
    flushing = false;
    stopped = false;
    // Hard cap so a sustained DB outage can never grow the buffer unbounded.
    static MAX_BUFFER = 10_000;
    constructor(pool, logDb, log, opts = {}) {
        this.pool = pool;
        this.logDb = logDb;
        this.log = log;
        this.bufferSize = opts.bufferSize ?? 100;
        this.flushIntervalMs = opts.flushIntervalMs ?? 5_000;
    }
    start() {
        if (this.timer)
            return;
        this.stopped = false;
        this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
        this.timer.unref?.();
    }
    debug(category, message, ctx) {
        this.enqueue('debug', category, message, ctx);
    }
    info(category, message, ctx) {
        this.enqueue('info', category, message, ctx);
    }
    warn(category, message, ctx) {
        this.enqueue('warn', category, message, ctx);
    }
    error(category, message, ctx) {
        this.enqueue('error', category, message, ctx);
    }
    fatal(category, message, ctx) {
        this.enqueue('fatal', category, message, ctx);
        // Fatal events are flushed immediately — we may be about to crash.
        void this.flush();
    }
    enqueue(logLevel, category, message, ctx) {
        if (this.stopped)
            return;
        if (this.buffer.length >= AdminLogger.MAX_BUFFER) {
            // Drop oldest to bound memory under a persistent sink outage.
            this.buffer.shift();
        }
        this.buffer.push({
            logLevel,
            category: category.slice(0, 64),
            message: message.slice(0, 8192),
            orgId: ctx?.orgId ?? null,
            projectId: ctx?.projectId ?? null,
            jobId: ctx?.jobId ?? null,
            eventId: ctx?.eventId ?? null,
            workerId: ctx?.workerId ?? null,
            metadata: ctx?.metadata ?? null,
            createdAt: new Date(),
        });
        if (this.buffer.length >= this.bufferSize) {
            void this.flush();
        }
    }
    /** Drain the buffer to both sinks. Re-entrancy guarded; never throws. */
    async flush() {
        if (this.flushing || this.buffer.length === 0)
            return;
        this.flushing = true;
        const batch = this.buffer;
        this.buffer = [];
        try {
            await this.writePrimary(batch);
            await this.logDb.writeAdminAudit(batch.map(toAuditRecord));
        }
        catch (err) {
            // Re-buffer (bounded) so the next cycle retries.
            this.buffer = batch.concat(this.buffer).slice(-AdminLogger.MAX_BUFFER);
            this.log.warn({ err }, 'AdminLogger flush failed; entries re-buffered');
        }
        finally {
            this.flushing = false;
        }
    }
    async writePrimary(batch) {
        const tuples = [];
        const params = [];
        let p = 1;
        for (const e of batch) {
            tuples.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::jsonb, $${p++})`);
            params.push(e.logLevel, e.category, e.message, e.orgId, e.projectId, e.jobId, e.eventId, e.workerId, e.metadata ? JSON.stringify(e.metadata) : null, e.createdAt.toISOString());
        }
        await this.pool.query(`INSERT INTO ingestion_admin_logs
         (log_level, category, message, org_id, project_id, job_id, event_id, worker_id, metadata, created_at)
       VALUES ${tuples.join(', ')}`, params);
    }
    /** Final flush + stop the timer. */
    async stop() {
        this.stopped = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        await this.flush();
    }
}
function toAuditRecord(e) {
    return {
        logLevel: e.logLevel,
        category: e.category,
        message: e.message,
        orgId: e.orgId ?? null,
        projectId: e.projectId ?? null,
        jobId: e.jobId ?? null,
        eventId: e.eventId ?? null,
        workerId: e.workerId ?? null,
        metadata: e.metadata ?? null,
        createdAt: e.createdAt,
    };
}
//# sourceMappingURL=admin-logger.js.map