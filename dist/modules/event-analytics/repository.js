import { AnalyticsQueryBuilder } from './query-builder.js';
export class EventAnalyticsRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async withTransaction(fn) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const r = await fn(client);
            await client.query('COMMIT');
            return r;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    // ── Overview ─────────────────────────────────────────────────────────────
    async getErrorStats(orgId, projectId, range) {
        const r = await this.db.query(`SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE severity='fatal')::bigint AS fatal,
              COUNT(*) FILTER (WHERE severity='error')::bigint AS error,
              COUNT(*) FILTER (WHERE severity='warning')::bigint AS warning
       FROM events_errors
       WHERE organization_id=$1 AND timestamp >= $2 AND timestamp < $3
         AND ($4::uuid IS NULL OR project_id=$4)`, [orgId, range.from, range.to, projectId ?? null]);
        const row = r.rows[0];
        return { total: Number(row.total), fatal: Number(row.fatal), error: Number(row.error), warning: Number(row.warning) };
    }
    async getRequestStats(orgId, projectId, range) {
        const r = await this.db.query(`SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS errors,
              AVG(latency_ms)::int AS avg,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::int AS p99
       FROM events_requests
       WHERE organization_id=$1 AND timestamp >= $2 AND timestamp < $3
         AND ($4::uuid IS NULL OR project_id=$4)`, [orgId, range.from, range.to, projectId ?? null]);
        const row = r.rows[0];
        const total = Number(row.total);
        const errors = Number(row.errors);
        return {
            total, errors,
            errorRate: total > 0 ? errors / total : 0,
            avgLatencyMs: row.avg !== null ? Number(row.avg) : null,
            p95: row.p95 !== null ? Number(row.p95) : null,
            p99: row.p99 !== null ? Number(row.p99) : null,
        };
    }
    async getUniqueUserCount(orgId, projectId, range) {
        const r = await this.db.query(`SELECT COUNT(DISTINCT user_id)::bigint AS count FROM events_requests
       WHERE organization_id=$1 AND timestamp >= $2 AND timestamp < $3
         AND user_id IS NOT NULL AND ($4::uuid IS NULL OR project_id=$4)`, [orgId, range.from, range.to, projectId ?? null]);
        return Number(r.rows[0]?.count ?? 0);
    }
    // ── Trends (time-series) ──────────────────────────────────────────────────
    async getEventTrend(tableKey, orgId, projectId, range, bucket, extraSelects = '') {
        const qb = new AnalyticsQueryBuilder(tableKey, orgId)
            .whereProject(projectId)
            .whereTimeRange(range.from, range.to);
        const { sql, params } = qb.timeSeries(bucket, extraSelects);
        const r = await this.db.query(sql, params);
        return r.rows;
    }
    // ── Errors ─────────────────────────────────────────────────────────────
    async listErrors(orgId, range, filters) {
        const qb = new AnalyticsQueryBuilder('errors', orgId)
            .whereProject(filters.projectId)
            .whereTimeRange(range.from, range.to)
            .whereEq('severity', filters.severity)
            .whereEq('service', filters.service)
            .whereEq('release', filters.release)
            .whereEq('fingerprint', filters.fingerprint)
            .whereSearch('message', filters.search);
        const countQ = qb.count();
        const countRes = await this.db.query(countQ.sql, countQ.params);
        qb.orderBy('timestamp', 'desc').paginate(filters.limit, filters.offset);
        const listQ = qb.select('id, event_id, fingerprint, message, error_name, severity, service, environment, release, trace_id, user_id, timestamp');
        const listRes = await this.db.query(listQ.sql, listQ.params);
        return { rows: listRes.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async getErrorById(orgId, id) {
        const r = await this.db.query(`SELECT * FROM events_errors WHERE organization_id=$1 AND id=$2 LIMIT 1`, [orgId, id]);
        return r.rows[0] ?? null;
    }
    async listErrorGroups(orgId, filters) {
        const conditions = ['organization_id=$1'];
        const params = [orgId];
        if (filters.projectId) {
            params.push(filters.projectId);
            conditions.push(`project_id=$${params.length}`);
        }
        if (filters.status) {
            params.push(filters.status);
            conditions.push(`status=$${params.length}`);
        }
        if (filters.search) {
            params.push(`%${filters.search}%`);
            conditions.push(`(error_name ILIKE $${params.length} OR message_template ILIKE $${params.length})`);
        }
        const where = conditions.join(' AND ');
        const countRes = await this.db.query(`SELECT COUNT(*)::bigint AS count FROM analytics_error_groups WHERE ${where}`, params);
        // sortBy is validated by the route schema (enum) — safe to interpolate.
        const sortCol = ['last_seen_at', 'first_seen_at', 'total_count'].includes(filters.sortBy) ? filters.sortBy : 'last_seen_at';
        const dir = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';
        params.push(filters.limit, filters.offset);
        const r = await this.db.query(`SELECT * FROM analytics_error_groups WHERE ${where}
       ORDER BY ${sortCol} ${dir} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async getErrorGroup(orgId, fingerprint) {
        const r = await this.db.query(`SELECT * FROM analytics_error_groups WHERE organization_id=$1 AND fingerprint=$2 LIMIT 1`, [orgId, fingerprint]);
        return r.rows[0] ?? null;
    }
    async updateErrorGroupStatus(orgId, fingerprint, status, assignedTo) {
        const r = await this.db.query(`UPDATE analytics_error_groups SET status=$3::error_group_status, assigned_to=COALESCE($4, assigned_to), updated_at=NOW()
       WHERE organization_id=$1 AND fingerprint=$2 RETURNING *`, [orgId, fingerprint, status, assignedTo]);
        return r.rows[0] ?? null;
    }
    // ── Performance ──────────────────────────────────────────────────────────
    /** Route performance from the pre-aggregated summary; falls back to live compute. */
    async getRoutePerformance(orgId, projectId, sinceDate, limit) {
        const summary = await this.db.query(`SELECT route, method,
              MAX(p50_latency_ms) AS p50, MAX(p95_latency_ms) AS p95, MAX(p99_latency_ms) AS p99,
              SUM(request_count)::bigint AS request_count, AVG(error_rate) AS error_rate, AVG(apdex_score) AS apdex
       FROM analytics_performance_summary
       WHERE organization_id=$1 AND bucket_date >= $2::date AND ($3::uuid IS NULL OR project_id=$3)
       GROUP BY route, method
       ORDER BY request_count DESC
       LIMIT $4`, [orgId, sinceDate, projectId ?? null, limit]);
        if (summary.rows.length > 0)
            return summary.rows;
        // Fallback: compute directly from events_requests (still single query).
        const live = await this.db.query(`SELECT route, method,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::int AS p99,
              COUNT(*)::bigint AS request_count,
              (COUNT(*) FILTER (WHERE status_code >= 500))::float / NULLIF(COUNT(*),0) AS error_rate
       FROM events_requests
       WHERE organization_id=$1 AND timestamp >= $2 AND ($3::uuid IS NULL OR project_id=$3) AND route IS NOT NULL
       GROUP BY route, method
       ORDER BY request_count DESC
       LIMIT $4`, [orgId, sinceDate, projectId ?? null, limit]);
        return live.rows;
    }
    async getLatencyDistribution(orgId, projectId, range) {
        const r = await this.db.query(`SELECT width_bucket(latency_ms, 0, 5000, 50) AS bucket,
              MIN(latency_ms) AS min_ms, MAX(latency_ms) AS max_ms, COUNT(*)::bigint AS count
       FROM events_requests
       WHERE organization_id=$1 AND timestamp >= $2 AND timestamp < $3 AND ($4::uuid IS NULL OR project_id=$4)
       GROUP BY bucket ORDER BY bucket ASC`, [orgId, range.from, range.to, projectId ?? null]);
        return r.rows;
    }
    /** Raw counts needed for an Apdex score (T = satisfied threshold ms). */
    async getApdexCounts(orgId, projectId, range, thresholdMs) {
        const r = await this.db.query(`SELECT COUNT(*) FILTER (WHERE latency_ms <= $5)::bigint AS satisfied,
              COUNT(*) FILTER (WHERE latency_ms > $5 AND latency_ms <= $5*4)::bigint AS tolerating,
              COUNT(*)::bigint AS total
       FROM events_requests
       WHERE organization_id=$1 AND timestamp >= $2 AND timestamp < $3 AND ($4::uuid IS NULL OR project_id=$4)`, [orgId, range.from, range.to, projectId ?? null, thresholdMs]);
        const row = r.rows[0];
        return { satisfied: Number(row.satisfied), tolerating: Number(row.tolerating), total: Number(row.total) };
    }
    // ── Requests / traces ──────────────────────────────────────────────────
    async listRequests(orgId, range, filters) {
        const qb = new AnalyticsQueryBuilder('requests', orgId)
            .whereProject(filters.projectId)
            .whereTimeRange(range.from, range.to)
            .whereEq('method', filters.method)
            .whereEq('status_code', filters.statusCode)
            .whereEq('route', filters.route)
            .whereTrue('is_slow', filters.slowOnly)
            .whereTrue('is_error', filters.errorOnly);
        const countQ = qb.count();
        const countRes = await this.db.query(countQ.sql, countQ.params);
        qb.orderBy('timestamp', 'desc').paginate(filters.limit, filters.offset);
        const listQ = qb.select('id, event_id, request_id, url, method, status_code, latency_ms, route, trace_id, user_id, is_slow, is_error, timestamp');
        const listRes = await this.db.query(listQ.sql, listQ.params);
        return { rows: listRes.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async getRequestById(orgId, id) {
        const r = await this.db.query(`SELECT * FROM events_requests WHERE organization_id=$1 AND id=$2 LIMIT 1`, [orgId, id]);
        return r.rows[0] ?? null;
    }
    async getSpansByTrace(orgId, traceId) {
        const r = await this.db.query(`SELECT id, span_id, trace_id, parent_span_id, name, kind, status, start_time, end_time, duration_ms,
              http_method, http_route, http_status_code, db_system, db_operation
       FROM events_spans WHERE organization_id=$1 AND trace_id=$2 ORDER BY start_time ASC`, [orgId, traceId]);
        return r.rows;
    }
    async getTraceById(orgId, traceId) {
        const r = await this.db.query(`SELECT * FROM events_traces WHERE organization_id=$1 AND trace_id=$2 ORDER BY timestamp DESC LIMIT 1`, [orgId, traceId]);
        return r.rows[0] ?? null;
    }
    async listTraces(orgId, range, projectId, limit, offset) {
        const qb = new AnalyticsQueryBuilder('traces', orgId).whereProject(projectId).whereTimeRange(range.from, range.to);
        const countQ = qb.count();
        const countRes = await this.db.query(countQ.sql, countQ.params);
        qb.orderBy('timestamp', 'desc').paginate(limit, offset);
        const listQ = qb.select('id, trace_id, root_span_name, root_span_id, span_count, total_duration_ms, service, timestamp');
        const listRes = await this.db.query(listQ.sql, listQ.params);
        return { rows: listRes.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    // ── Metrics ─────────────────────────────────────────────────────────────
    async listMetricNames(orgId, projectId, range) {
        const r = await this.db.query(`SELECT metric_name, metric_type, COUNT(*)::bigint AS sample_count, MAX(timestamp) AS last_seen
       FROM events_metrics
       WHERE organization_id=$1 AND timestamp >= $2 AND timestamp < $3 AND ($4::uuid IS NULL OR project_id=$4)
       GROUP BY metric_name, metric_type ORDER BY metric_name ASC LIMIT 1000`, [orgId, range.from, range.to, projectId ?? null]);
        return r.rows;
    }
    async getMetricSeries(orgId, name, range, bucket, aggregate, projectId) {
        // aggregate is validated by the route enum — safe to interpolate the fn name.
        const fn = ['avg', 'sum', 'min', 'max', 'count'].includes(aggregate) ? aggregate : 'avg';
        const expr = fn === 'count' ? 'COUNT(*)' : `${fn.toUpperCase()}(value)`;
        const r = await this.db.query(`SELECT DATE_TRUNC('${bucket}', timestamp) AS bucket, ${expr}::float AS value
       FROM events_metrics
       WHERE organization_id=$1 AND metric_name=$2 AND timestamp >= $3 AND timestamp < $4
         AND ($5::uuid IS NULL OR project_id=$5)
       GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`, [orgId, name, range.from, range.to, projectId ?? null]);
        return r.rows;
    }
    async getMetricStats(orgId, name, range, projectId) {
        const r = await this.db.query(`SELECT COUNT(*)::bigint AS count, MIN(value)::float AS min, MAX(value)::float AS max, AVG(value)::float AS avg,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value)::float AS p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)::float AS p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY value)::float AS p99
       FROM events_metrics
       WHERE organization_id=$1 AND metric_name=$2 AND timestamp >= $3 AND timestamp < $4
         AND ($5::uuid IS NULL OR project_id=$5)`, [orgId, name, range.from, range.to, projectId ?? null]);
        return r.rows[0] ?? null;
    }
    // ── Logs ─────────────────────────────────────────────────────────────────
    async listLogs(orgId, range, filters) {
        const qb = new AnalyticsQueryBuilder('logs', orgId)
            .whereProject(filters.projectId)
            .whereTimeRange(range.from, range.to)
            .whereEq('level', filters.level)
            .whereFullText('message', filters.search);
        const countQ = qb.count();
        const countRes = await this.db.query(countQ.sql, countQ.params);
        qb.orderBy('timestamp', 'desc').paginate(filters.limit, filters.offset);
        const listQ = qb.select('id, event_id, level, message, service, trace_id, request_id, timestamp');
        const listRes = await this.db.query(listQ.sql, listQ.params);
        return { rows: listRes.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    /** Logs newer than a cursor timestamp — used by the SSE poll loop. */
    async listLogsSince(orgId, since, projectId, limit) {
        const r = await this.db.query(`SELECT id, level, message, service, trace_id, timestamp FROM events_logs
       WHERE organization_id=$1 AND timestamp > $2 AND ($3::uuid IS NULL OR project_id=$3)
       ORDER BY timestamp ASC LIMIT $4`, [orgId, since, projectId ?? null, limit]);
        return r.rows;
    }
    async listErrorsSince(orgId, since, projectId, limit) {
        const r = await this.db.query(`SELECT id, fingerprint, message, error_name, severity, service, timestamp FROM events_errors
       WHERE organization_id=$1 AND timestamp > $2 AND ($3::uuid IS NULL OR project_id=$3)
       ORDER BY timestamp ASC LIMIT $4`, [orgId, since, projectId ?? null, limit]);
        return r.rows;
    }
    // ── Sessions / users ───────────────────────────────────────────────────
    async listSessions(orgId, range, filters) {
        const conditions = ['organization_id=$1', 'started_at >= $2', 'started_at < $3'];
        const params = [orgId, range.from, range.to];
        if (filters.projectId) {
            params.push(filters.projectId);
            conditions.push(`project_id=$${params.length}`);
        }
        if (filters.userId) {
            params.push(filters.userId);
            conditions.push(`user_id=$${params.length}`);
        }
        if (filters.crashedOnly)
            conditions.push('is_crashed = true');
        const where = conditions.join(' AND ');
        const countRes = await this.db.query(`SELECT COUNT(*)::bigint AS count FROM analytics_user_sessions WHERE ${where}`, params);
        params.push(filters.limit, filters.offset);
        const r = await this.db.query(`SELECT * FROM analytics_user_sessions WHERE ${where} ORDER BY started_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: r.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async getSession(orgId, sessionId) {
        const r = await this.db.query(`SELECT * FROM analytics_user_sessions WHERE organization_id=$1 AND session_id=$2 LIMIT 1`, [orgId, sessionId]);
        return r.rows[0] ?? null;
    }
    async listUsers(orgId, range, projectId, limit, offset) {
        const r = await this.db.query(`SELECT user_id,
              COUNT(*)::bigint AS request_count,
              MAX(timestamp) AS last_seen
       FROM events_requests
       WHERE organization_id=$1 AND timestamp >= $2 AND timestamp < $3 AND user_id IS NOT NULL AND ($4::uuid IS NULL OR project_id=$4)
       GROUP BY user_id ORDER BY request_count DESC LIMIT $5 OFFSET $6`, [orgId, range.from, range.to, projectId ?? null, limit, offset]);
        return r.rows;
    }
    async getUserJourney(orgId, userId, range, limit) {
        const [errors, requests] = await Promise.all([
            this.db.query(`SELECT id, error_name, message, severity, timestamp FROM events_errors
         WHERE organization_id=$1 AND user_id=$2 AND timestamp >= $3 AND timestamp < $4
         ORDER BY timestamp DESC LIMIT $5`, [orgId, userId, range.from, range.to, limit]),
            this.db.query(`SELECT id, method, route, status_code, latency_ms, timestamp FROM events_requests
         WHERE organization_id=$1 AND user_id=$2 AND timestamp >= $3 AND timestamp < $4
         ORDER BY timestamp DESC LIMIT $5`, [orgId, userId, range.from, range.to, limit]),
        ]);
        return { errors: errors.rows, requests: requests.rows };
    }
    // ── Crons ────────────────────────────────────────────────────────────────
    async listCrons(orgId, projectId) {
        const r = await this.db.query(`SELECT DISTINCT ON (monitor_slug) monitor_slug, status, duration_ms, timestamp
       FROM events_cron_checkins
       WHERE organization_id=$1 AND ($2::uuid IS NULL OR project_id=$2)
       ORDER BY monitor_slug, timestamp DESC`, [orgId, projectId ?? null]);
        return r.rows;
    }
    async getCronHistory(orgId, slug, limit, offset) {
        const r = await this.db.query(`SELECT id, status, duration_ms, environment, timestamp FROM events_cron_checkins
       WHERE organization_id=$1 AND monitor_slug=$2 ORDER BY timestamp DESC LIMIT $3 OFFSET $4`, [orgId, slug, limit, offset]);
        return r.rows;
    }
    // ── Dashboards CRUD ──────────────────────────────────────────────────────
    async createDashboard(input) {
        const r = await this.db.query(`INSERT INTO analytics_dashboards (organization_id, project_id, name, description, layout, widgets, is_shared, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [input.orgId, input.projectId, input.name, input.description, JSON.stringify(input.layout), JSON.stringify(input.widgets), input.isShared, input.createdBy]);
        return r.rows[0];
    }
    async listDashboards(orgId) {
        const r = await this.db.query(`SELECT * FROM analytics_dashboards WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [orgId]);
        return r.rows;
    }
    async getDashboard(orgId, id) {
        const r = await this.db.query(`SELECT * FROM analytics_dashboards WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`, [orgId, id]);
        return r.rows[0] ?? null;
    }
    async updateDashboard(orgId, id, fields, updatedBy) {
        const map = { name: 'name', description: 'description', layout: 'layout', widgets: 'widgets', isShared: 'is_shared' };
        const set = ['updated_by=$1'];
        const vals = [updatedBy];
        for (const [k, v] of Object.entries(fields)) {
            if (v === undefined || !map[k])
                continue;
            vals.push(['layout', 'widgets'].includes(k) ? JSON.stringify(v) : v);
            set.push(`${map[k]}=$${vals.length}`);
        }
        vals.push(id, orgId);
        const r = await this.db.query(`UPDATE analytics_dashboards SET ${set.join(',')} WHERE id=$${vals.length - 1} AND organization_id=$${vals.length} AND deleted_at IS NULL RETURNING *`, vals);
        return r.rows[0] ?? null;
    }
    async deleteDashboard(orgId, id) {
        const r = await this.db.query(`UPDATE analytics_dashboards SET deleted_at=NOW() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, orgId]);
        return (r.rowCount ?? 0) > 0;
    }
    // ── Saved queries CRUD ───────────────────────────────────────────────────
    async createSavedQuery(input) {
        const r = await this.db.query(`INSERT INTO analytics_saved_queries (organization_id, project_id, name, description, query_type, query_config, visualization_type, visualization_config, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [input.orgId, input.projectId, input.name, input.description, input.queryType, JSON.stringify(input.queryConfig), input.visualizationType, JSON.stringify(input.visualizationConfig), input.createdBy]);
        return r.rows[0];
    }
    async listSavedQueries(orgId) {
        const r = await this.db.query(`SELECT * FROM analytics_saved_queries WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [orgId]);
        return r.rows;
    }
    async getSavedQuery(orgId, id) {
        const r = await this.db.query(`SELECT * FROM analytics_saved_queries WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`, [orgId, id]);
        return r.rows[0] ?? null;
    }
    async deleteSavedQuery(orgId, id) {
        const r = await this.db.query(`UPDATE analytics_saved_queries SET deleted_at=NOW() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, orgId]);
        return (r.rowCount ?? 0) > 0;
    }
    // ── Analytics alerts CRUD ────────────────────────────────────────────────
    async createAlert(input) {
        const r = await this.db.query(`INSERT INTO analytics_alerts (organization_id, project_id, name, metric, operator, threshold, window_minutes, notification_channels, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5::analytics_alert_operator,$6,$7,$8,$9,$10) RETURNING *`, [input.orgId, input.projectId, input.name, input.metric, input.operator, input.threshold, input.windowMinutes, JSON.stringify(input.notificationChannels), input.isActive, input.createdBy]);
        return r.rows[0];
    }
    async listAlerts(orgId) {
        const r = await this.db.query(`SELECT * FROM analytics_alerts WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [orgId]);
        return r.rows;
    }
    async getAlert(orgId, id) {
        const r = await this.db.query(`SELECT * FROM analytics_alerts WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`, [orgId, id]);
        return r.rows[0] ?? null;
    }
    async deleteAlert(orgId, id) {
        const r = await this.db.query(`UPDATE analytics_alerts SET deleted_at=NOW() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, orgId]);
        return (r.rowCount ?? 0) > 0;
    }
    // ── Export ─────────────────────────────────────────────────────────────
    async exportDataset(orgId, dataset, range, projectId, limit) {
        const table = { errors: 'events_errors', requests: 'events_requests', logs: 'events_logs', metrics: 'events_metrics' }[dataset];
        const r = await this.db.query(`SELECT * FROM ${table}
       WHERE organization_id=$1 AND timestamp >= $2 AND timestamp < $3 AND ($4::uuid IS NULL OR project_id=$4)
       ORDER BY timestamp DESC LIMIT $5`, [orgId, range.from, range.to, projectId ?? null, limit]);
        return r.rows;
    }
    // ── Rollup helpers (called by workers) ───────────────────────────────────
    async refreshHourlyRollup(orgId, startHour, endHour) {
        await this.db.query(`SELECT refresh_hourly_rollup($1, $2, $3)`, [orgId, startHour, endHour]);
    }
    async listOrgsWithRecentErrors(sinceHours) {
        const r = await this.db.query(`SELECT DISTINCT organization_id FROM events_errors WHERE created_at > NOW() - ($1 || ' hours')::interval LIMIT 1000`, [String(sinceHours)]);
        return r.rows.map((row) => row.organization_id);
    }
    /**
     * Reconcile error groups from recent error events (single statement).
     *
     * The ingestion worker's inline grouper owns occurrence counts in real time
     * (analytics_error_groups.total_count etc. are incremented per inserted
     * event). This periodic job must NOT add to counts — re-adding a trailing
     * window's COUNT(*) double-counts on every overlapping run (it did even
     * before inline grouping existed). It now only:
     *   - INSERTs groups the inline path missed (e.g. grouping failed while the
     *     event insert succeeded), with the window count as the initial total;
     *   - refreshes descriptive fields and last_seen_at for existing groups.
     */
    async refreshErrorGroups(orgId, sinceHours) {
        await this.db.query(`INSERT INTO analytics_error_groups
         (organization_id, project_id, fingerprint, error_name, message_template,
          first_seen_at, last_seen_at, total_count, services, environments, releases)
       SELECT organization_id, project_id, fingerprint,
              (array_agg(error_name ORDER BY timestamp DESC))[1],
              (array_agg(message ORDER BY timestamp DESC))[1],
              MIN(timestamp), MAX(timestamp), COUNT(*)::int,
              ARRAY(SELECT DISTINCT service FROM events_errors e2 WHERE e2.organization_id=ee.organization_id AND e2.fingerprint=ee.fingerprint AND service IS NOT NULL),
              ARRAY(SELECT DISTINCT environment FROM events_errors e3 WHERE e3.organization_id=ee.organization_id AND e3.fingerprint=ee.fingerprint AND environment IS NOT NULL),
              ARRAY(SELECT DISTINCT release FROM events_errors e4 WHERE e4.organization_id=ee.organization_id AND e4.fingerprint=ee.fingerprint AND release IS NOT NULL)
       FROM events_errors ee
       WHERE organization_id=$1 AND created_at > NOW() - ($2 || ' hours')::interval
       GROUP BY organization_id, project_id, fingerprint
       ON CONFLICT (organization_id, project_id, fingerprint) DO UPDATE SET
         last_seen_at = GREATEST(analytics_error_groups.last_seen_at, EXCLUDED.last_seen_at),
         first_seen_at = LEAST(analytics_error_groups.first_seen_at, EXCLUDED.first_seen_at),
         error_name = EXCLUDED.error_name,
         message_template = EXCLUDED.message_template,
         services = EXCLUDED.services,
         environments = EXCLUDED.environments,
         releases = EXCLUDED.releases,
         updated_at = NOW()`, [orgId, String(sinceHours)]);
    }
    async ping() {
        try {
            await this.db.query('SELECT 1');
            return true;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=repository.js.map