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
    async getErrorStats(orgId, projectId, environment, range) {
        const r = await this.db.query(`SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE severity='fatal')::bigint AS fatal,
              COUNT(*) FILTER (WHERE severity='error')::bigint AS error,
              COUNT(*) FILTER (WHERE severity='warning')::bigint AS warning
       FROM events_errors
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3
         AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)`, [orgId, range.from, range.to, projectId ?? null, environment ?? null]);
        const row = r.rows[0];
        return { total: Number(row.total), fatal: Number(row.fatal), error: Number(row.error), warning: Number(row.warning) };
    }
    async getRequestStats(orgId, projectId, environment, range) {
        const r = await this.db.query(`SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS errors,
              AVG(latency_ms)::int AS avg,
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::int AS p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::int AS p99
       FROM events_requests
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3
         AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)`, [orgId, range.from, range.to, projectId ?? null, environment ?? null]);
        const row = r.rows[0];
        const total = Number(row.total);
        const errors = Number(row.errors);
        return {
            total, errors,
            errorRate: total > 0 ? errors / total : 0,
            avgLatencyMs: row.avg !== null ? Number(row.avg) : null,
            p50: row.p50 !== null ? Number(row.p50) : null,
            p95: row.p95 !== null ? Number(row.p95) : null,
            p99: row.p99 !== null ? Number(row.p99) : null,
        };
    }
    async getUniqueUserCount(orgId, projectId, environment, range) {
        const r = await this.db.query(`SELECT COUNT(DISTINCT user_id)::bigint AS count FROM events_requests
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3
         AND user_id IS NOT NULL AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)`, [orgId, range.from, range.to, projectId ?? null, environment ?? null]);
        return Number(r.rows[0]?.count ?? 0);
    }
    // ── Trends (time-series) ──────────────────────────────────────────────────
    async getEventTrend(tableKey, orgId, projectId, environment, range, bucket, extraSelects = '') {
        const qb = new AnalyticsQueryBuilder(tableKey, orgId)
            .whereProject(projectId)
            .whereEnvironment(environment)
            .whereTimeRange(range.from, range.to);
        const { sql, params } = qb.timeSeries(bucket, extraSelects);
        const r = await this.db.query(sql, params);
        return r.rows;
    }
    // ── Errors ─────────────────────────────────────────────────────────────
    async listErrors(orgId, range, filters) {
        const qb = new AnalyticsQueryBuilder('errors', orgId)
            .whereProject(filters.projectId)
            .whereEnvironment(filters.environment)
            .whereTimeRange(range.from, range.to)
            .whereEq('severity', filters.severity)
            .whereEq('service', filters.service)
            .whereEq('release', filters.release)
            .whereEq('fingerprint', filters.fingerprint)
            .whereSearch('message', filters.search);
        const countQ = qb.count();
        const countRes = await this.db.query(countQ.sql, countQ.params);
        qb.orderBy('occurred_at', 'desc').paginate(filters.limit, filters.offset);
        const listQ = qb.select('id, event_id, fingerprint, message, error_name, severity, service, environment, release, trace_id, user_id, occurred_at');
        const listRes = await this.db.query(listQ.sql, listQ.params);
        return { rows: listRes.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async getErrorById(orgId, id, projectId, environment) {
        const r = await this.db.query(`SELECT * FROM events_errors
       WHERE organization_id=$1 AND id=$2
         AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       LIMIT 1`, [orgId, id, projectId ?? null, environment ?? null]);
        return r.rows[0] ?? null;
    }
    async listErrorGroups(orgId, filters) {
        const conditions = ['organization_id=$1'];
        const params = [orgId];
        if (filters.projectId) {
            params.push(filters.projectId);
            conditions.push(`project_id=$${params.length}`);
        }
        if (filters.environment) {
            params.push(filters.environment);
            conditions.push(`$${params.length}=ANY(environments)`);
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
    async getErrorGroup(orgId, projectId, fingerprint, environment) {
        const r = await this.db.query(`SELECT * FROM analytics_error_groups
       WHERE organization_id=$1 AND project_id=$2 AND fingerprint=$3
         AND $4=ANY(environments)
       LIMIT 1`, [orgId, projectId, fingerprint, environment]);
        return r.rows[0] ?? null;
    }
    async updateErrorGroupStatus(orgId, projectId, fingerprint, environment, status, assignedTo) {
        const r = await this.db.query(`UPDATE analytics_error_groups
          SET status=$5,
              assigned_to=COALESCE($6, assigned_to),
              resolved_at=CASE WHEN $5='resolved' THEN NOW() ELSE NULL END,
              resolved_by=CASE WHEN $5='resolved' THEN COALESCE($6, resolved_by) ELSE NULL END,
              updated_at=NOW()
       WHERE organization_id=$1 AND project_id=$2 AND fingerprint=$3
         AND $4=ANY(environments)
       RETURNING *`, [orgId, projectId, fingerprint, environment, status, assignedTo]);
        return r.rows[0] ?? null;
    }
    // ── Performance ──────────────────────────────────────────────────────────
    /** Route performance from the pre-aggregated summary; falls back to live compute. */
    async getRoutePerformance(orgId, projectId, environment, sinceDate, limit) {
        const summary = await this.db.query(`SELECT route, method,
              MAX(p50_latency_ms) AS p50, MAX(p95_latency_ms) AS p95, MAX(p99_latency_ms) AS p99,
              SUM(request_count)::bigint AS request_count, AVG(error_rate) AS error_rate, AVG(apdex_score) AS apdex
       FROM analytics_performance_summary
       WHERE organization_id=$1 AND bucket_date >= $2::date AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       GROUP BY route, method
       ORDER BY request_count DESC
       LIMIT $5`, [orgId, sinceDate, projectId ?? null, environment ?? null, limit]);
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
       WHERE organization_id=$1 AND occurred_at >= $2 AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4) AND route IS NOT NULL
       GROUP BY route, method
       ORDER BY request_count DESC
       LIMIT $5`, [orgId, sinceDate, projectId ?? null, environment ?? null, limit]);
        return live.rows;
    }
    async getLatencyDistribution(orgId, projectId, environment, range) {
        const r = await this.db.query(`SELECT width_bucket(latency_ms, 0, 5000, 50) AS bucket,
              MIN(latency_ms) AS min_ms, MAX(latency_ms) AS max_ms, COUNT(*)::bigint AS count
       FROM events_requests
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)
       GROUP BY bucket ORDER BY bucket ASC`, [orgId, range.from, range.to, projectId ?? null, environment ?? null]);
        return r.rows;
    }
    /** Raw counts needed for an Apdex score (T = satisfied threshold ms). */
    async getApdexCounts(orgId, projectId, environment, range, thresholdMs) {
        const r = await this.db.query(`SELECT COUNT(*) FILTER (WHERE latency_ms <= $6)::bigint AS satisfied,
              COUNT(*) FILTER (WHERE latency_ms > $6 AND latency_ms <= $6*4)::bigint AS tolerating,
              COUNT(*)::bigint AS total
       FROM events_requests
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)`, [orgId, range.from, range.to, projectId ?? null, environment ?? null, thresholdMs]);
        const row = r.rows[0];
        return { satisfied: Number(row.satisfied), tolerating: Number(row.tolerating), total: Number(row.total) };
    }
    // ── Requests / traces ──────────────────────────────────────────────────
    async listRequests(orgId, range, filters) {
        const qb = new AnalyticsQueryBuilder('requests', orgId)
            .whereProject(filters.projectId)
            .whereEnvironment(filters.environment)
            .whereTimeRange(range.from, range.to)
            .whereEq('method', filters.method)
            .whereEq('status_code', filters.statusCode)
            .whereEq('route', filters.route)
            .whereTrue('is_slow', filters.slowOnly)
            .whereTrue('is_error', filters.errorOnly);
        const countQ = qb.count();
        const countRes = await this.db.query(countQ.sql, countQ.params);
        qb.orderBy('occurred_at', 'desc').paginate(filters.limit, filters.offset);
        const listQ = qb.select('id, event_id, request_id, url, method, status_code, latency_ms, route, trace_id, user_id, environment, is_slow, is_error, occurred_at');
        const listRes = await this.db.query(listQ.sql, listQ.params);
        return { rows: listRes.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async getRequestById(orgId, id, projectId, environment) {
        const r = await this.db.query(`SELECT * FROM events_requests
       WHERE organization_id=$1 AND id=$2
         AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       LIMIT 1`, [orgId, id, projectId ?? null, environment ?? null]);
        return r.rows[0] ?? null;
    }
    async getSpansByTrace(orgId, traceId, projectId, environment) {
        const r = await this.db.query(`SELECT id, span_id, trace_id, parent_span_id, name, span_kind, span_status, start_time, end_time, duration_ms,
              http_method, http_route, http_status_code, db_system, db_operation, environment
       FROM events_spans
       WHERE organization_id=$1 AND trace_id=$2 AND project_id=$3 AND environment=$4
       ORDER BY start_time ASC`, [orgId, traceId, projectId, environment]);
        return r.rows;
    }
    async getTraceById(orgId, traceId, projectId, environment) {
        const r = await this.db.query(`SELECT * FROM events_traces
       WHERE organization_id=$1 AND trace_id=$2 AND project_id=$3 AND environment=$4
       ORDER BY occurred_at DESC LIMIT 1`, [orgId, traceId, projectId, environment]);
        return r.rows[0] ?? null;
    }
    async listTraces(orgId, range, filters) {
        const conditions = ['t.organization_id=$1', 't.occurred_at >= $2', 't.occurred_at < $3'];
        const params = [orgId, range.from, range.to];
        if (filters.projectId) {
            params.push(filters.projectId);
            conditions.push(`t.project_id=$${params.length}`);
        }
        if (filters.environment) {
            params.push(filters.environment);
            conditions.push(`t.environment=$${params.length}`);
        }
        if (filters.traceId) {
            params.push(filters.traceId);
            conditions.push(`t.trace_id=$${params.length}`);
        }
        if (filters.requestId) {
            params.push(filters.requestId);
            conditions.push(`t.request_id=$${params.length}`);
        }
        if (filters.service) {
            params.push(filters.service);
            conditions.push(`t.service=$${params.length}`);
        }
        if (filters.rootSpanName) {
            params.push(`%${filters.rootSpanName}%`);
            conditions.push(`t.root_span_name ILIKE $${params.length}`);
        }
        if (filters.minDurationMs !== undefined) {
            params.push(filters.minDurationMs);
            conditions.push(`t.total_duration_ms >= $${params.length}`);
        }
        const errorPredicate = `EXISTS (
      SELECT 1 FROM events_spans s
      WHERE s.organization_id=t.organization_id AND s.project_id=t.project_id
        AND s.trace_id=t.trace_id AND s.environment=t.environment AND s.span_status='error'
    )`;
        if (filters.errorOnly)
            conditions.push(errorPredicate);
        const where = conditions.join(' AND ');
        const countRes = await this.db.query(`SELECT COUNT(*)::bigint AS count FROM events_traces t WHERE ${where}`, params);
        params.push(filters.limit, filters.offset);
        const rows = await this.db.query(`SELECT t.id, t.trace_id, t.root_span_name, t.root_span_id, t.span_count,
              t.total_duration_ms, t.request_id, t.service, t.environment, t.release,
              t.occurred_at, ${errorPredicate} AS has_error
       FROM events_traces t WHERE ${where}
       ORDER BY t.occurred_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { rows: rows.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    // ── Metrics ─────────────────────────────────────────────────────────────
    async listMetricNames(orgId, projectId, environment, range) {
        const r = await this.db.query(`SELECT metric_name, metric_type, COUNT(*)::bigint AS sample_count, MAX(occurred_at) AS last_seen
       FROM events_metrics
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)
       GROUP BY metric_name, metric_type ORDER BY metric_name ASC LIMIT 1000`, [orgId, range.from, range.to, projectId ?? null, environment ?? null]);
        return r.rows;
    }
    async getMetricSeries(orgId, name, range, bucket, aggregate, projectId, environment) {
        // aggregate is validated by the route enum — safe to interpolate the fn name.
        const fn = ['avg', 'sum', 'min', 'max', 'count'].includes(aggregate) ? aggregate : 'avg';
        const expr = fn === 'count' ? 'COUNT(*)' : `${fn.toUpperCase()}(value)`;
        const r = await this.db.query(`SELECT DATE_TRUNC('${bucket}', occurred_at) AS bucket, ${expr}::float AS value
       FROM events_metrics
       WHERE organization_id=$1 AND metric_name=$2 AND occurred_at >= $3 AND occurred_at < $4
         AND ($5::uuid IS NULL OR project_id=$5)
         AND ($6::text IS NULL OR environment=$6)
       GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`, [orgId, name, range.from, range.to, projectId ?? null, environment ?? null]);
        return r.rows;
    }
    async getMetricStats(orgId, name, range, projectId, environment) {
        const r = await this.db.query(`SELECT COUNT(*)::bigint AS count, MIN(value)::float AS min, MAX(value)::float AS max, AVG(value)::float AS avg,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value)::float AS p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)::float AS p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY value)::float AS p99
       FROM events_metrics
       WHERE organization_id=$1 AND metric_name=$2 AND occurred_at >= $3 AND occurred_at < $4
         AND ($5::uuid IS NULL OR project_id=$5)
         AND ($6::text IS NULL OR environment=$6)`, [orgId, name, range.from, range.to, projectId ?? null, environment ?? null]);
        return r.rows[0] ?? null;
    }
    // ── Logs ─────────────────────────────────────────────────────────────────
    async listLogs(orgId, range, filters) {
        const qb = new AnalyticsQueryBuilder('logs', orgId)
            .whereProject(filters.projectId)
            .whereEnvironment(filters.environment)
            .whereTimeRange(range.from, range.to)
            .whereEq('level', filters.level)
            .whereEq('service', filters.service)
            .whereFullText('message', filters.search);
        if (filters.securityOnly) {
            qb.whereRaw(`message ~* ?`, '(authentication|login).*fail|unauthorized|forbidden|access denied|privilege|credential|token.*invalid');
        }
        const countQ = qb.count();
        const countRes = await this.db.query(countQ.sql, countQ.params);
        qb.orderBy('occurred_at', 'desc').paginate(filters.limit, filters.offset);
        const listQ = qb.select('id, event_id, level, message, logger, service, trace_id, span_id, request_id, environment, release, context, occurred_at');
        const listRes = await this.db.query(listQ.sql, listQ.params);
        return { rows: listRes.rows, total: Number(countRes.rows[0]?.count ?? 0) };
    }
    async getLog(orgId, id) {
        const result = await this.db.query(`SELECT id, event_id, level, message, logger, service, trace_id, span_id, request_id,
              environment, release, context, tags, occurred_at
       FROM events_logs WHERE organization_id=$1 AND id=$2 LIMIT 1`, [orgId, id]);
        return result.rows[0] ?? null;
    }
    async summarizeLogs(orgId, range, filters) {
        const conditions = ['organization_id=$1', 'occurred_at >= $2', 'occurred_at < $3'];
        const params = [orgId, range.from, range.to];
        if (filters.projectId) {
            params.push(filters.projectId);
            conditions.push(`project_id=$${params.length}`);
        }
        if (filters.environment) {
            params.push(filters.environment);
            conditions.push(`environment=$${params.length}`);
        }
        if (filters.level) {
            params.push(filters.level);
            conditions.push(`level=$${params.length}`);
        }
        if (filters.service) {
            params.push(filters.service);
            conditions.push(`service=$${params.length}`);
        }
        if (filters.search) {
            params.push(filters.search);
            conditions.push(`to_tsvector('english', message) @@ plainto_tsquery('english', $${params.length})`);
        }
        params.push(Math.max(1, Math.min(filters.limit, 100)));
        const result = await this.db.query(`SELECT level, service, message, COUNT(*)::bigint AS occurrences, MAX(occurred_at) AS last_seen
       FROM events_logs
       WHERE ${conditions.join(' AND ')}
       GROUP BY level, service, message
       ORDER BY occurrences DESC, last_seen DESC
       LIMIT $${params.length}`, params);
        return result.rows;
    }
    async listObservedServices(orgId, range, projectId, environment, limit) {
        const result = await this.db.query(`WITH observations AS (
         SELECT project_id, service, occurred_at, 'trace'::text AS source FROM events_traces
          WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
            AND ($5::text IS NULL OR environment=$5)
         UNION ALL
         SELECT project_id, service, occurred_at, 'request'::text AS source FROM events_requests
          WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
            AND ($5::text IS NULL OR environment=$5)
         UNION ALL
         SELECT project_id, service, occurred_at, 'log'::text AS source FROM events_logs
          WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
            AND ($5::text IS NULL OR environment=$5)
       )
       SELECT o.service, o.project_id, p.name AS project_name, p.slug AS project_slug,
              COUNT(*)::bigint AS observed_event_count,
              COUNT(*) FILTER (WHERE o.source='trace')::bigint AS trace_count,
              COUNT(*) FILTER (WHERE o.source='request')::bigint AS request_count,
              COUNT(*) FILTER (WHERE o.source='log')::bigint AS log_count,
              MAX(o.occurred_at) AS last_seen
       FROM observations o
       LEFT JOIN project_lookup p ON p.project_id=o.project_id AND p.organization_id=$1
       WHERE o.service IS NOT NULL AND BTRIM(o.service) <> ''
       GROUP BY o.service, o.project_id, p.name, p.slug
       ORDER BY last_seen DESC
       LIMIT $6`, [orgId, range.from, range.to, projectId ?? null, environment ?? null, Math.max(1, Math.min(limit, 100))]);
        return result.rows;
    }
    async listServiceEndpoints(orgId, service, range, projectId, environment, limit) {
        const result = await this.db.query(`SELECT route, method, COUNT(*)::bigint AS request_count,
              COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS error_count,
              AVG(latency_ms)::int AS avg_latency_ms,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95_latency_ms,
              MAX(occurred_at) AS last_seen
       FROM events_requests
       WHERE organization_id=$1 AND service=$2 AND occurred_at >= $3 AND occurred_at < $4
         AND ($5::uuid IS NULL OR project_id=$5)
         AND ($6::text IS NULL OR environment=$6) AND route IS NOT NULL
       GROUP BY route, method
       ORDER BY request_count DESC
       LIMIT $7`, [orgId, service, range.from, range.to, projectId ?? null, environment ?? null, Math.max(1, Math.min(limit, 100))]);
        return result.rows;
    }
    /** Logs newer than a cursor timestamp — used by the SSE poll loop. */
    async listLogsSince(orgId, since, projectId, environment, limit) {
        const r = await this.db.query(`SELECT id, level, message, service, trace_id, environment, occurred_at FROM events_logs
       WHERE organization_id=$1 AND occurred_at > $2 AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       ORDER BY occurred_at ASC LIMIT $5`, [orgId, since, projectId ?? null, environment ?? null, limit]);
        return r.rows;
    }
    async listErrorsSince(orgId, since, projectId, environment, limit) {
        const r = await this.db.query(`SELECT id, fingerprint, message, error_name, severity, service, environment, occurred_at FROM events_errors
       WHERE organization_id=$1 AND occurred_at > $2 AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       ORDER BY occurred_at ASC LIMIT $5`, [orgId, since, projectId ?? null, environment ?? null, limit]);
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
        if (filters.environment) {
            params.push(filters.environment);
            conditions.push(`environment=$${params.length}`);
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
    async getSession(orgId, sessionId, projectId, environment) {
        const r = await this.db.query(`SELECT * FROM analytics_user_sessions
       WHERE organization_id=$1 AND session_id=$2 AND project_id=$3 AND environment=$4
       LIMIT 1`, [orgId, sessionId, projectId, environment]);
        return r.rows[0] ?? null;
    }
    async listUsers(orgId, range, projectId, environment, limit, offset) {
        const r = await this.db.query(`SELECT user_id,
              COUNT(*)::bigint AS request_count,
              MAX(occurred_at) AS last_seen
       FROM events_requests
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND user_id IS NOT NULL AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)
       GROUP BY user_id ORDER BY request_count DESC LIMIT $6 OFFSET $7`, [orgId, range.from, range.to, projectId ?? null, environment ?? null, limit, offset]);
        return r.rows;
    }
    async getUserJourney(orgId, userId, range, projectId, environment, limit) {
        const params = [orgId, userId, range.from, range.to, projectId ?? null, environment ?? null, limit];
        const [errors, requests] = await Promise.all([
            this.db.query(`SELECT id, error_name, message, severity, environment, occurred_at FROM events_errors
         WHERE organization_id=$1 AND user_id=$2 AND occurred_at >= $3 AND occurred_at < $4
           AND ($5::uuid IS NULL OR project_id=$5)
           AND ($6::text IS NULL OR environment=$6)
         ORDER BY occurred_at DESC LIMIT $7`, params),
            this.db.query(`SELECT id, method, route, status_code, latency_ms, environment, occurred_at FROM events_requests
         WHERE organization_id=$1 AND user_id=$2 AND occurred_at >= $3 AND occurred_at < $4
           AND ($5::uuid IS NULL OR project_id=$5)
           AND ($6::text IS NULL OR environment=$6)
         ORDER BY occurred_at DESC LIMIT $7`, params),
        ]);
        return { errors: errors.rows, requests: requests.rows };
    }
    // ── Crons ────────────────────────────────────────────────────────────────
    async listCrons(orgId, projectId, environment) {
        const r = await this.db.query(`SELECT DISTINCT ON (monitor_slug) monitor_slug, status, duration_ms, occurred_at
       FROM events_cron_checkins
       WHERE organization_id=$1 AND ($2::uuid IS NULL OR project_id=$2)
         AND ($3::text IS NULL OR environment=$3)
       ORDER BY monitor_slug, occurred_at DESC`, [orgId, projectId ?? null, environment ?? null]);
        return r.rows;
    }
    async getCronHistory(orgId, slug, projectId, environment, limit, offset) {
        const r = await this.db.query(`SELECT id, status, duration_ms, environment, occurred_at FROM events_cron_checkins
       WHERE organization_id=$1 AND monitor_slug=$2
         AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       ORDER BY occurred_at DESC LIMIT $5 OFFSET $6`, [orgId, slug, projectId ?? null, environment ?? null, limit, offset]);
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
    async exportDataset(orgId, dataset, range, projectId, environment, limit) {
        const table = { errors: 'events_errors', requests: 'events_requests', logs: 'events_logs', metrics: 'events_metrics' }[dataset];
        const r = await this.db.query(`SELECT * FROM ${table}
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)
       ORDER BY occurred_at DESC LIMIT $6`, [orgId, range.from, range.to, projectId ?? null, environment ?? null, limit]);
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
              (array_agg(error_name ORDER BY occurred_at DESC))[1],
              (array_agg(message ORDER BY occurred_at DESC))[1],
              MIN(occurred_at), MAX(occurred_at), COUNT(*)::int,
              ARRAY(SELECT DISTINCT service FROM events_errors e2 WHERE e2.organization_id=ee.organization_id AND e2.project_id=ee.project_id AND e2.fingerprint=ee.fingerprint AND service IS NOT NULL),
              ARRAY(SELECT DISTINCT environment FROM events_errors e3 WHERE e3.organization_id=ee.organization_id AND e3.project_id=ee.project_id AND e3.fingerprint=ee.fingerprint AND environment IS NOT NULL),
              ARRAY(SELECT DISTINCT release FROM events_errors e4 WHERE e4.organization_id=ee.organization_id AND e4.project_id=ee.project_id AND e4.fingerprint=ee.fingerprint AND release IS NOT NULL)
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