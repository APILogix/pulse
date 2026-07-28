const REALTIME_COLUMNS = {
    events: 'total_events',
    total_events: 'total_events',
    events_ingested: 'total_events',
    events_persisted: 'total_events',
    requests: 'requests',
    events_received: 'requests',
    errors: 'errors',
    events_rejected: 'errors',
    bytes_ingested: 'total_bytes',
    rate_limited: 'rate_limit_usage',
    events_shed: 'rate_limit_usage',
};
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
    start() {
        if (this.timer)
            return;
        this.stopped = false;
        this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
        this.timer.unref?.();
        this.log.info({ flushIntervalMs: this.flushIntervalMs }, 'UsageCounter started');
    }
    increment(projectId, orgId, counterType, by = 1, dimensions = {}) {
        if (this.stopped || !projectId || !orgId || !counterType || by <= 0)
            return;
        const apiKeyId = dimensions.apiKeyId ?? null;
        const eventType = dimensions.eventType?.trim() || 'all';
        const key = [projectId, orgId, counterType, apiKeyId ?? '', eventType].join('\u0000');
        const existing = this.buffer.get(key);
        if (existing)
            existing.value += by;
        else
            this.buffer.set(key, { projectId, orgId, counterType, value: by, apiKeyId, eventType });
        if (this.buffer.size >= this.bufferLimit)
            void this.flush();
    }
    async flush() {
        if (this.flushing)
            return;
        if (this.buffer.size === 0) {
            await this.runRollup();
            return;
        }
        this.flushing = true;
        const draining = this.buffer;
        this.buffer = new Map();
        try {
            const tuples = [];
            const params = [];
            let parameter = 1;
            for (const entry of draining.values()) {
                tuples.push(`($${parameter++}, $${parameter++}, $${parameter++}, $${parameter++}, $${parameter++}, $${parameter++})`);
                params.push(entry.projectId, entry.orgId, entry.apiKeyId, entry.eventType, entry.counterType, entry.value);
            }
            await this.pool.query(`INSERT INTO usage_counter_staging (
           project_id, org_id, api_key_id, event_type, counter_type, increment_by
         ) VALUES ${tuples.join(', ')}`, params);
        }
        catch (err) {
            for (const [key, entry] of draining) {
                const current = this.buffer.get(key);
                if (current)
                    current.value += entry.value;
                else
                    this.buffer.set(key, entry);
            }
            this.log.warn({ err }, 'UsageCounter staging flush failed; counts re-buffered');
        }
        finally {
            this.flushing = false;
        }
        await this.runRollup();
    }
    async runRollup() {
        if (!this.driveRollup)
            return;
        try {
            for (let i = 0; i < 20; i++) {
                const result = await this.pool.query('SELECT flushed_count FROM flush_usage_counters()');
                if (result.rowCount === 0)
                    break;
            }
        }
        catch (err) {
            this.log.warn({ err }, 'UsageCounter rollup (flush_usage_counters) failed');
        }
    }
    async getUsage(projectId, counterType, periodStart) {
        const column = REALTIME_COLUMNS[counterType];
        if (!column)
            return 0;
        const params = [projectId];
        const bucketClause = periodStart ? ' AND bucket = $2' : '';
        if (periodStart)
            params.push(periodStart);
        const result = await this.pool.query(`SELECT COALESCE(SUM(${column}), 0)::text AS total_value
         FROM project_usage_realtime
        WHERE project_id = $1${bucketClause}`, params);
        return Number(result.rows[0]?.total_value ?? 0);
    }
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