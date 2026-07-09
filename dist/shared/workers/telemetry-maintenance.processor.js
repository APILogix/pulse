const PARTITIONED_TABLES = [
    'spans', 'traces', 'metrics', 'logs', 'profiles',
    'cron_checkins', 'replays', 'messages', 'sdk_sessions',
    'errors', 'requests',
];
// Default retention: 90 days. Per-table overrides could come from
// telemetry_retention_policies later.
const DEFAULT_RETENTION_MONTHS = 3;
function partitionName(table, year, month) {
    return `${table}_y${year}_m${String(month).padStart(2, '0')}`;
}
function monthBounds(year, month) {
    // month is 1-based. Build [first-of-month, first-of-next-month).
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const to = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    return { from, to };
}
export class TelemetryMaintenanceWorker {
    pool;
    log;
    opts;
    timer = null;
    constructor(pool, log, opts = {}) {
        this.pool = pool;
        this.log = log;
        this.opts = opts;
    }
    start() {
        if (this.timer)
            return;
        const interval = this.opts.intervalMs ?? 6 * 60 * 60 * 1000; // every 6h
        // Run once at startup, then on the interval.
        void this.runOnce();
        this.timer = setInterval(() => void this.runOnce(), interval);
        this.timer.unref?.();
        this.log.info({ intervalMs: interval }, 'Telemetry maintenance worker started');
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async runOnce() {
        try {
            await this.ensureFuturePartitions();
            await this.dropExpiredPartitions();
        }
        catch (err) {
            this.log.error({ err }, 'Telemetry maintenance cycle failed');
        }
    }
    /** Pre-create the current and next month partitions for every table. */
    async ensureFuturePartitions() {
        const now = new Date();
        const targets = [
            { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 },
            this.addMonth(now.getUTCFullYear(), now.getUTCMonth() + 1),
        ];
        for (const table of PARTITIONED_TABLES) {
            for (const { y, m } of targets) {
                const name = partitionName(table, y, m);
                const { from, to } = monthBounds(y, m);
                // Partition bounds CANNOT be bind parameters (Postgres rejects $1 in
                // DDL). These date strings are internally computed (YYYY-MM-01), never
                // user input, so direct interpolation is safe from injection.
                await this.pool.query(`CREATE TABLE IF NOT EXISTS ${name}
             PARTITION OF ${table}
             FOR VALUES FROM ('${from}') TO ('${to}')`).catch((err) => {
                    // A range conflict means a manual/DEFAULT partition already covers
                    // this range — safe to ignore.
                    this.log.debug({ err, name }, 'partition create skipped');
                });
            }
        }
    }
    /** Drop partitions whose entire range is older than the retention window. */
    async dropExpiredPartitions() {
        const retentionMonths = this.opts.retentionMonths ?? DEFAULT_RETENTION_MONTHS;
        const cutoff = new Date();
        cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionMonths);
        for (const table of PARTITIONED_TABLES) {
            // Find child partitions following the y<YYYY>_m<MM> convention.
            const children = await this.pool.query(`SELECT inhrelid::regclass::text AS child
         FROM pg_inherits
         WHERE inhparent = $1::regclass`, [table]).catch(() => ({ rows: [] }));
            for (const { child } of children.rows) {
                const match = /_y(\d{4})_m(\d{2})$/.exec(child);
                if (!match)
                    continue; // skip DEFAULT and non-conventional partitions
                const y = Number(match[1]);
                const m = Number(match[2]);
                const { to } = monthBounds(y, m);
                // If the partition's upper bound is before the cutoff, the whole
                // partition is expired — drop it.
                if (new Date(to) <= cutoff) {
                    await this.pool.query(`DROP TABLE IF EXISTS ${child}`).catch((err) => {
                        this.log.warn({ err, child }, 'Failed to drop expired partition');
                    });
                    this.log.info({ child }, 'Dropped expired telemetry partition');
                }
            }
        }
    }
    addMonth(year, month) {
        return month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
    }
}
//# sourceMappingURL=telemetry-maintenance.processor.js.map