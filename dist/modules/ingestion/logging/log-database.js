/**
 * LogDatabase — separate TimescaleDB instance for operational metrics, worker
 * performance and admin audit analytics.
 *
 * Why a SECOND database:
 *   Operational telemetry about the ingestion system itself (queue depth,
 *   throughput, per-worker latency, admin actions) is high-volume, append-only
 *   time-series data with very different access patterns from the primary OLTP
 *   database. Keeping it in a dedicated TimescaleDB instance:
 *     - isolates heavy time-series writes from the transactional primary,
 *     - lets us use hypertables + continuous aggregates + retention policies,
 *     - means a logging outage never impacts ingestion correctness.
 *
 * Graceful degradation:
 *   If TIMESCALEDB_URL is not configured, LogDatabase becomes a no-op (every
 *   write silently returns, initialize() reports "disabled"). The ingestion
 *   pipeline does not depend on it for correctness — it is observability only.
 *
 * Connection: TIMESCALEDB_URL env var. TimescaleDB is PostgreSQL + the
 * timescaledb extension, so the standard `pg` Pool works unchanged.
 */
import { Pool } from 'pg';
import { env } from '../../../config/env.js';
export class LogDatabase {
    log;
    pool = null;
    enabled = false;
    initialized = false;
    constructor(log) {
        this.log = log;
    }
    /** True once initialize() succeeded against a configured TimescaleDB. */
    isEnabled() {
        return this.enabled;
    }
    /**
     * Create the pool, extensions, hypertables, continuous aggregate and
     * retention policies. Safe to call once at worker startup. Idempotent on the
     * DB side (all DDL guarded with IF NOT EXISTS). When TIMESCALEDB_URL is unset
     * this is a no-op that logs an info line and leaves the instance disabled.
     */
    async initialize() {
        if (this.initialized)
            return;
        this.initialized = true;
        const url = env.TIMESCALEDB_URL;
        if (!url) {
            this.log.info('LogDatabase disabled (TIMESCALEDB_URL not set)');
            return;
        }
        this.pool = new Pool({
            connectionString: url,
            max: env.INGESTION_LOG_DB_POOL_SIZE,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 10_000,
            application_name: 'pulse_ingestion_logdb',
            keepAlive: true,
        });
        this.pool.on('error', (err) => this.log.error({ err }, 'LogDatabase pool error'));
        try {
            await this.pool.query('SELECT 1');
            await this.createSchema();
            this.enabled = true;
            this.log.info('LogDatabase initialized (TimescaleDB)');
        }
        catch (err) {
            this.enabled = false;
            this.log.error({ err }, 'LogDatabase initialization failed; logging disabled');
            await this.pool.end().catch(() => { });
            this.pool = null;
        }
    }
    async createSchema() {
        const db = this.pool;
        await db.query(`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE`);
        // 1) ingestion_metrics — generic metric points (queue depth, throughput...).
        await db.query(`
      CREATE TABLE IF NOT EXISTS ingestion_metrics (
        time        TIMESTAMPTZ NOT NULL,
        metric_name VARCHAR(128) NOT NULL,
        value       DOUBLE PRECISION NOT NULL,
        project_id  UUID,
        org_id      UUID,
        tags        JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata    JSONB
      )
    `);
        await db.query(`SELECT create_hypertable('ingestion_metrics', 'time',
         chunk_time_interval => INTERVAL '1 hour', if_not_exists => TRUE)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_name_time
         ON ingestion_metrics (metric_name, time DESC)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_ingestion_metrics_project
         ON ingestion_metrics (project_id, metric_name, time DESC) WHERE project_id IS NOT NULL`);
        // 2) worker_performance — per-worker metrics.
        await db.query(`
      CREATE TABLE IF NOT EXISTS worker_performance (
        time            TIMESTAMPTZ NOT NULL,
        worker_id       VARCHAR(128) NOT NULL,
        worker_type     VARCHAR(64) NOT NULL,
        jobs_processed  BIGINT NOT NULL DEFAULT 0,
        jobs_failed     BIGINT NOT NULL DEFAULT 0,
        avg_duration_ms DOUBLE PRECISION,
        p95_duration_ms DOUBLE PRECISION,
        batch_size      INTEGER,
        poll_cycles     BIGINT,
        metadata        JSONB
      )
    `);
        await db.query(`SELECT create_hypertable('worker_performance', 'time',
         chunk_time_interval => INTERVAL '1 hour', if_not_exists => TRUE)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_worker_perf_worker_time
         ON worker_performance (worker_id, time DESC)`);
        // 3) admin_audit_log — admin operations (daily chunks).
        await db.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        time       TIMESTAMPTZ NOT NULL,
        log_level  VARCHAR(16) NOT NULL,
        category   VARCHAR(64) NOT NULL,
        message    TEXT NOT NULL,
        org_id     UUID,
        project_id UUID,
        job_id     UUID,
        event_id   VARCHAR(64),
        worker_id  VARCHAR(128),
        metadata   JSONB
      )
    `);
        await db.query(`SELECT create_hypertable('admin_audit_log', 'time',
         chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_category_time
         ON admin_audit_log (category, time DESC)`);
        // 4) Continuous aggregate: hourly metric summary.
        await db.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS ingestion_hourly_summary
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 hour', time) AS bucket,
        metric_name,
        project_id,
        COUNT(*)        AS sample_count,
        AVG(value)      AS avg_value,
        MAX(value)      AS max_value,
        MIN(value)      AS min_value,
        SUM(value)      AS sum_value
      FROM ingestion_metrics
      GROUP BY bucket, metric_name, project_id
      WITH NO DATA
    `).catch((err) => {
            // Continuous aggregates cannot be created inside a txn block on some
            // versions; log and continue (the raw hypertable still works).
            this.log.warn({ err }, 'continuous aggregate create skipped');
        });
        // 5) Retention policies: raw 7 days, aggregate 90 days.
        await db.query(`SELECT add_retention_policy('ingestion_metrics', INTERVAL '7 days', if_not_exists => TRUE)`).catch(() => { });
        await db.query(`SELECT add_retention_policy('worker_performance', INTERVAL '7 days', if_not_exists => TRUE)`).catch(() => { });
        await db.query(`SELECT add_retention_policy('admin_audit_log', INTERVAL '90 days', if_not_exists => TRUE)`).catch(() => { });
        await db.query(`SELECT add_retention_policy('ingestion_hourly_summary', INTERVAL '90 days', if_not_exists => TRUE)`).catch(() => { });
    }
    /** Insert one metric point. No-op when disabled. Never throws. */
    async writeMetric(name, value, opts = {}) {
        if (!this.enabled || !this.pool)
            return;
        try {
            await this.pool.query(`INSERT INTO ingestion_metrics (time, metric_name, value, project_id, org_id, tags, metadata)
         VALUES (NOW(), $1, $2, $3, $4, $5::jsonb, $6::jsonb)`, [
                name.slice(0, 128),
                value,
                opts.projectId ?? null,
                opts.orgId ?? null,
                JSON.stringify(opts.tags ?? {}),
                opts.metadata ? JSON.stringify(opts.metadata) : null,
            ]);
        }
        catch (err) {
            this.log.debug({ err, name }, 'writeMetric failed');
        }
    }
    /** Insert a per-worker performance row. No-op when disabled. Never throws. */
    async writeWorkerPerformance(rec) {
        if (!this.enabled || !this.pool)
            return;
        try {
            await this.pool.query(`INSERT INTO worker_performance
           (time, worker_id, worker_type, jobs_processed, jobs_failed,
            avg_duration_ms, p95_duration_ms, batch_size, poll_cycles, metadata)
         VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`, [
                rec.workerId.slice(0, 128),
                rec.workerType.slice(0, 64),
                rec.jobsProcessed,
                rec.jobsFailed ?? 0,
                rec.avgDurationMs ?? null,
                rec.p95DurationMs ?? null,
                rec.batchSize ?? null,
                rec.pollCycles ?? null,
                rec.metadata ? JSON.stringify(rec.metadata) : null,
            ]);
        }
        catch (err) {
            this.log.debug({ err, workerId: rec.workerId }, 'writeWorkerPerformance failed');
        }
    }
    /** Bulk insert admin audit rows (called by AdminLogger). No-op when disabled. */
    async writeAdminAudit(records) {
        if (!this.enabled || !this.pool || records.length === 0)
            return;
        const tuples = [];
        const params = [];
        let p = 1;
        for (const r of records) {
            tuples.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::jsonb)`);
            params.push((r.createdAt ?? new Date()).toISOString(), r.logLevel, r.category, r.message, r.orgId ?? null, r.projectId ?? null, r.jobId ?? null, r.eventId ?? null, r.workerId ?? null, r.metadata ? JSON.stringify(r.metadata) : null);
        }
        try {
            await this.pool.query(`INSERT INTO admin_audit_log
           (time, log_level, category, message, org_id, project_id, job_id, event_id, worker_id, metadata)
         VALUES ${tuples.join(', ')}`, params);
        }
        catch (err) {
            this.log.debug({ err }, 'writeAdminAudit failed');
        }
    }
    /** Query historical metric points. Returns [] when disabled. */
    async queryMetrics(name, timeRange, projectId) {
        if (!this.enabled || !this.pool)
            return [];
        const r = await this.pool.query(`SELECT time, metric_name, value, project_id, tags
       FROM ingestion_metrics
       WHERE metric_name = $1 AND time >= $2 AND time <= $3
         ${projectId ? 'AND project_id = $4' : ''}
       ORDER BY time DESC
       LIMIT 10000`, projectId
            ? [name, timeRange.from.toISOString(), timeRange.to.toISOString(), projectId]
            : [name, timeRange.from.toISOString(), timeRange.to.toISOString()]);
        return r.rows;
    }
    /** Close the pool. */
    async end() {
        if (this.pool) {
            await this.pool.end().catch(() => { });
            this.pool = null;
        }
        this.enabled = false;
    }
}
//# sourceMappingURL=log-database.js.map