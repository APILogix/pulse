export class UsageCounter {
    pool;
    log;
    buffer = new Map();
    flushIntervalMs;
    bufferLimit;
    driveRollup;
    timer = null;
    flushing = false;
    stopped = false;
    constructor(pool, log, opts = {}) {
        this.pool = pool;
        this.log = log;
        this.flushIntervalMs = opts.flushIntervalMs ?? 30_000;
        this.bufferLimit = opts.bufferLimit ?? 10_000;
        this.driveRollup = opts.driveRollup ?? true;
    }
    /** Start the periodic flush timer. Safe to call once. */
    start() {
        if (this.timer)
            return;
        this.stopped = false;
        this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
        // Don't keep the process alive solely for the counter flush.
        this.timer.unref?.();
        this.log.info({ flushIntervalMs: this.flushIntervalMs }, 'UsageCounter started');
    }
    /**
     * Tier-1 increment. Fire-and-forget: updates memory only, never awaits, never
     * throws. When the buffer crosses the limit we kick off an async flush but do
     * NOT block the caller on it.
     */
    increment(projectId, orgId, counterType, by = 1) {
        if (this.stopped)
            return;
        if (!projectId || !orgId || !counterType || by <= 0)
            return;
        const key = `${projectId}\u0000${orgId}\u0000${counterType}`;
        const existing = this.buffer.get(key);
        if (existing) {
            existing.value += by;
        }
        else {
            this.buffer.set(key, { projectId, orgId, counterType, value: by });
        }
        if (this.buffer.size >= this.bufferLimit) {
            void this.flush();
        }
    }
    /**
     * Tier-1 -> Tier-2 -> Tier-3 flush. Drains the in-memory map into a single
     * multi-row INSERT against the UNLOGGED staging table, then asks Postgres to
     * roll settled staging rows up into the durable hourly buckets.
     *
     * Re-entrancy guarded: only one flush runs at a time. On insert failure the
     * drained counts are merged back into the buffer so nothing is lost between
     * flush attempts.
     */
    async flush() {
        if (this.flushing)
            return;
        if (this.buffer.size === 0) {
            // Still drive the rollup so staging never accumulates if increments
            // happened in another process.
            await this.runRollup();
            return;
        }
        this.flushing = true;
        // Atomically swap out the current buffer so concurrent increments land in a
        // fresh map and are not lost mid-flush.
        const draining = this.buffer;
        this.buffer = new Map();
        try {
            const entries = [...draining.values()];
            const tuples = [];
            const params = [];
            let p = 1;
            for (const e of entries) {
                tuples.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
                params.push(e.projectId, e.orgId, e.counterType, e.value);
            }
            await this.pool.query(`INSERT INTO usage_counter_staging (project_id, org_id, counter_type, increment_by)
         VALUES ${tuples.join(', ')}`, params);
        }
        catch (err) {
            // Merge the un-inserted counts back so the next flush retries them.
            for (const [key, e] of draining) {
                const cur = this.buffer.get(key);
                if (cur)
                    cur.value += e.value;
                else
                    this.buffer.set(key, e);
            }
            this.log.warn({ err }, 'UsageCounter staging flush failed; counts re-buffered');
        }
        finally {
            this.flushing = false;
        }
        await this.runRollup();
    }
    /** Drive flush_usage_counters() until it stops returning work (bounded). */
    async runRollup() {
        if (!this.driveRollup)
            return;
        try {
            // The SQL function consumes up to 10k staging rows per call. Loop a
            // bounded number of times so a backlog drains without an unbounded loop.
            for (let i = 0; i < 20; i++) {
                const r = await this.pool.query(`SELECT flushed_count FROM flush_usage_counters()`);
                if (r.rowCount === 0)
                    break;
            }
        }
        catch (err) {
            this.log.warn({ err }, 'UsageCounter rollup (flush_usage_counters) failed');
        }
    }
    /**
     * Read current usage for a project/counter. Uses the realtime view so the
     * un-flushed staging tail is included. When periodStart is omitted, sums all
     * buckets for the counter.
     */
    async getUsage(projectId, counterType, periodStart) {
        if (periodStart) {
            const r = await this.pool.query(`SELECT COALESCE(SUM(total_value), 0)::text AS total_value
         FROM project_usage_realtime
         WHERE project_id = $1 AND counter_type = $2 AND period_start = $3`, [projectId, counterType, periodStart.toISOString()]);
            return Number(r.rows[0]?.total_value ?? 0);
        }
        const r = await this.pool.query(`SELECT COALESCE(SUM(total_value), 0)::text AS total_value
       FROM project_usage_realtime
       WHERE project_id = $1 AND counter_type = $2`, [projectId, counterType]);
        return Number(r.rows[0]?.total_value ?? 0);
    }
    /** Final flush + stop the timer. Call on graceful shutdown. */
    async stop() {
        this.stopped = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        await this.flush();
        this.log.info('UsageCounter stopped (final flush complete)');
    }
}
//# sourceMappingURL=usage-counter.js.map