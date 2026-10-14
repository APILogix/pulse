/**
 * Event-analytics persistence layer.
 *
 * All reads are organization-scoped (tenant isolation) and time-ranged so they
 * use the indexes from migration 004. No N+1: detail endpoints fetch related
 * rows via bulk/`= ANY` queries or run independent queries concurrently in the
 * service layer. No caching (per requirements).
 */
import type { Pool, PoolClient } from 'pg';
import { AnalyticsQueryBuilder, type AnalyticsTableKey, type TimeBucket } from './query-builder.js';
import type { TimeRange } from './types.js';
import { mergeHistograms, parseHistogram, percentileFromHistogram } from '../analytics-engine/histogram.js';
import { estimateUnion, fromBuffer } from '../analytics-engine/hll.js';

export const ANALYTICS_ERROR_GROUP_COLUMNS = `
  id, organization_id, project_id, fingerprint, error_name, message_template, first_seen_at, last_seen_at, total_count, today_count, week_count, month_count, status, assigned_to, services, environments, releases, created_at, updated_at
`;

export const ANALYTICS_DASHBOARD_COLUMNS = `
  id, organization_id, project_id, name, description, layout, widgets, is_shared, created_by, created_at, updated_at
`;

export const ANALYTICS_SAVED_QUERY_COLUMNS = `
  id, organization_id, project_id, name, description, query_type, query_config, visualization_type, visualization_config, created_by, created_at, updated_at
`;

export const ANALYTICS_ALERT_COLUMNS = `
  id, organization_id, project_id, name, metric, operator, threshold, window_minutes, notification_channels, is_active, created_by, created_at, updated_at
`;

export const ANALYTICS_USER_SESSION_COLUMNS = `
  id, organization_id, project_id, session_id, user_id, started_at, ended_at, duration_seconds, event_count, error_count, pages, is_crashed, created_at
`;

export class EventAnalyticsRepository {
  constructor(private readonly db: Pool) {}

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(client);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ── Overview ─────────────────────────────────────────────────────────────
  async getErrorStats(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange): Promise<{
    total: number; fatal: number; error: number; warning: number;
  }> {
    const r = await this.db.query<{ total: string; fatal: string; error: string; warning: string }>(
      `SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE severity='fatal')::bigint AS fatal,
              COUNT(*) FILTER (WHERE severity='error')::bigint AS error,
              COUNT(*) FILTER (WHERE severity='warning')::bigint AS warning
       FROM events_errors
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3
         AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)`,
      [orgId, range.from, range.to, projectId ?? null, environment ?? null],
    );
    const row = r.rows[0]!;
    return { total: Number(row.total), fatal: Number(row.fatal), error: Number(row.error), warning: Number(row.warning) };
  }

  /**
   * Request statistics across a time range.
   *
   * ANL-Q006 optimization: reads from pre-aggregated rollups (request_metrics_1h / request_metrics_1m)
   * where available, merging logarithmic histograms in memory to estimate p50/p95/p99 without
   * heavy PERCENTILE_CONT sorting over raw events_requests partitions. Falls back to raw table
   * only if rollup data is not yet available for the requested range.
   */
  async getRequestStats(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange): Promise<{
    total: number; errors: number; errorRate: number; avgLatencyMs: number | null;
    p50: number | null; p95: number | null; p99: number | null;
  }> {
    const durationMs = range.to.getTime() - range.from.getTime();
    const table = durationMs > 3 * 3600 * 1000 ? 'request_metrics_1h' : 'request_metrics_1m';

    const conditions = ['r.organization_id = $1', 'r.bucket >= $2', 'r.bucket < $3'];
    const params: unknown[] = [orgId, range.from, range.to];
    if (projectId) {
      params.push(projectId);
      conditions.push(`r.project_id = $${params.length}`);
    }
    if (environment) {
      params.push(environment);
      conditions.push(`r.environment = $${params.length}`);
    }

    try {
      const rollupRes = await this.db.query<{
        total: string; errors: string; latency_sum_ms: string;
        histograms: unknown[];
      }>(
        `SELECT COALESCE(SUM(r.total_count), 0)::bigint AS total,
                COALESCE(SUM(r.error_count), 0)::bigint AS errors,
                COALESCE(SUM(r.latency_sum_ms), 0)::numeric AS latency_sum_ms,
                ARRAY_AGG(r.latency_hist) FILTER (WHERE r.latency_hist IS NOT NULL) AS histograms
         FROM ${table} r
         WHERE ${conditions.join(' AND ')}`,
        params,
      );

      const rollupRow = rollupRes.rows[0];
      const total = Number(rollupRow?.total ?? 0);
      if (total > 0) {
        const errors = Number(rollupRow?.errors ?? 0);
        const latencySumMs = Number(rollupRow?.latency_sum_ms ?? 0);
        const rawHists = rollupRow?.histograms;
        const histograms = Array.isArray(rawHists)
          ? (rawHists as unknown[]).map((h) => parseHistogram(h))
          : [];
        const mergedHist = mergeHistograms(histograms);

        return {
          total,
          errors,
          errorRate: total > 0 ? errors / total : 0,
          avgLatencyMs: total > 0 ? Math.round(latencySumMs / total) : null,
          p50: percentileFromHistogram(mergedHist, 0.50),
          p95: percentileFromHistogram(mergedHist, 0.95),
          p99: percentileFromHistogram(mergedHist, 0.99),
        };
      }
    } catch {
      // Rollup query failed or table not populated; fall through to raw fallback
    }

    const rawConditions = ['organization_id=$1', 'occurred_at >= $2', 'occurred_at < $3'];
    const rawParams: unknown[] = [orgId, range.from, range.to];
    if (projectId) {
      rawParams.push(projectId);
      rawConditions.push(`project_id=$${rawParams.length}`);
    }
    if (environment) {
      rawParams.push(environment);
      rawConditions.push(`environment=$${rawParams.length}`);
    }

    const r = await this.db.query<{
      total: string; errors: string; avg: string | null;
      p50: string | null; p95: string | null; p99: string | null;
    }>(
      `SELECT COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS errors,
              AVG(latency_ms)::int AS avg,
              PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::int AS p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::int AS p99
       FROM events_requests
       WHERE ${rawConditions.join(' AND ')}`,
      rawParams,
    );
    const row = r.rows[0];
    const total = Number(row?.total ?? 0);
    const errors = Number(row?.errors ?? 0);
    return {
      total, errors,
      errorRate: total > 0 ? errors / total : 0,
      avgLatencyMs: row?.avg !== null && row?.avg !== undefined ? Number(row.avg) : null,
      p50: row?.p50 !== null && row?.p50 !== undefined ? Number(row.p50) : null,
      p95: row?.p95 !== null && row?.p95 !== undefined ? Number(row.p95) : null,
      p99: row?.p99 !== null && row?.p99 !== undefined ? Number(row.p99) : null,
    };
  }

  /**
   * Unique user count across a time range.
   *
   * ANL-Q007 optimization: reads from pre-aggregated rollups using HLL sketches
   * (or exact bucket counts) where available, avoiding massive HashAggregates over
   * raw events_requests.
   */
  async getUniqueUserCount(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange): Promise<number> {
    const durationMs = range.to.getTime() - range.from.getTime();
    const table = durationMs > 3 * 3600 * 1000 ? 'request_metrics_1h' : 'request_metrics_1m';

    const conditions = ['r.organization_id = $1', 'r.bucket >= $2', 'r.bucket < $3'];
    const params: unknown[] = [orgId, range.from, range.to];
    if (projectId) {
      params.push(projectId);
      conditions.push(`r.project_id = $${params.length}`);
    }
    if (environment) {
      params.push(environment);
      conditions.push(`r.environment = $${params.length}`);
    }

    try {
      const rollupRes = await this.db.query<{
        unique_users_exact: string;
        sketches: unknown[];
      }>(
        `SELECT MAX(r.unique_users_exact)::bigint AS unique_users_exact,
                ARRAY_AGG(r.unique_users_hll) FILTER (WHERE r.unique_users_hll IS NOT NULL) AS sketches
         FROM ${table} r
         WHERE ${conditions.join(' AND ')}`,
        params,
      );

      const row = rollupRes.rows[0];
      if (row) {
        const rawSketches = row.sketches;
        if (Array.isArray(rawSketches) && rawSketches.length > 0) {
          const sketches = (rawSketches as unknown[]).map((s) => fromBuffer(s)).filter((s): s is Uint8Array => s !== null);
          if (sketches.length > 0) {
            return estimateUnion(sketches);
          }
        }
        const exact = Number(row.unique_users_exact ?? 0);
        if (exact > 0) return exact;
      }
    } catch {
      // Fall through to raw fallback
    }

    const rawConditions = ['organization_id=$1', 'occurred_at >= $2', 'occurred_at < $3', 'user_id IS NOT NULL'];
    const rawParams: unknown[] = [orgId, range.from, range.to];
    if (projectId) {
      rawParams.push(projectId);
      rawConditions.push(`project_id=$${rawParams.length}`);
    }
    if (environment) {
      rawParams.push(environment);
      rawConditions.push(`environment=$${rawParams.length}`);
    }

    const r = await this.db.query<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id)::bigint AS count FROM events_requests
       WHERE ${rawConditions.join(' AND ')}`,
      rawParams,
    );
    return Number(r.rows[0]?.count ?? 0);
  }

  // ── Trends (time-series) ──────────────────────────────────────────────────
  async getEventTrend(
    tableKey: AnalyticsTableKey, orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange, bucket: TimeBucket,
    extraSelects = '',
  ): Promise<Array<Record<string, unknown>>> {
    const qb = new AnalyticsQueryBuilder(tableKey, orgId)
      .whereProject(projectId)
      .whereEnvironment(environment)
      .whereTimeRange(range.from, range.to);
    const { sql, params } = qb.timeSeries(bucket, extraSelects);
    const r = await this.db.query(sql, params);
    return r.rows as Array<Record<string, unknown>>;
  }

  // ── Errors ─────────────────────────────────────────────────────────────
  async listErrors(orgId: string, range: TimeRange, filters: {
    projectId?: string; environment?: string; severity?: string; service?: string; release?: string; search?: string; fingerprint?: string;
    limit: number; offset: number;
  }): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
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
    const countRes = await this.db.query<{ count: string }>(countQ.sql, countQ.params);

    qb.orderBy('occurred_at', 'desc').paginate(filters.limit, filters.offset);
    const listQ = qb.select(
      'id, event_id, fingerprint, message, error_name, severity, service, environment, release, trace_id, user_id, occurred_at',
    );
    const listRes = await this.db.query(listQ.sql, listQ.params);
    return { rows: listRes.rows as Array<Record<string, unknown>>, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async getErrorById(
    orgId: string,
    id: string,
    projectId?: string,
    environment?: string,
  ): Promise<Record<string, unknown> | null> {
    const r = await this.db.query(
      `SELECT id, organization_id, project_id, environment, event_id, error_name, message, severity, method, route, url, status_code, service, release, occurred_at
       FROM events_errors
       WHERE organization_id=$1 AND id=$2
         AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       LIMIT 1`,
      [orgId, id, projectId ?? null, environment ?? null],
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  async listErrorGroups(orgId: string, filters: {
    projectId?: string; environment?: string; status?: string; search?: string; sortBy: string; sortOrder: 'asc' | 'desc'; limit: number; offset: number;
  }): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
    const conditions = ['organization_id=$1'];
    const params: unknown[] = [orgId];
    if (filters.projectId) { params.push(filters.projectId); conditions.push(`project_id=$${params.length}`); }
    if (filters.environment) { params.push(filters.environment); conditions.push(`$${params.length}=ANY(environments)`); }
    if (filters.status) { params.push(filters.status); conditions.push(`status=$${params.length}`); }
    if (filters.search) { params.push(`%${filters.search}%`); conditions.push(`(error_name ILIKE $${params.length} OR message_template ILIKE $${params.length})`); }
    const where = conditions.join(' AND ');

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count FROM analytics_error_groups WHERE ${where}`, params,
    );
    // sortBy is validated by the route schema (enum) — safe to interpolate.
    const sortCol = ['last_seen_at', 'first_seen_at', 'total_count'].includes(filters.sortBy) ? filters.sortBy : 'last_seen_at';
    const dir = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';
    params.push(filters.limit, filters.offset);
    const r = await this.db.query(
      `SELECT ${ANALYTICS_ERROR_GROUP_COLUMNS} FROM analytics_error_groups WHERE ${where}
       ORDER BY ${sortCol} ${dir} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { rows: r.rows as Array<Record<string, unknown>>, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async getErrorGroup(
    orgId: string,
    projectId: string,
    fingerprint: string,
    environment: string,
  ): Promise<Record<string, unknown> | null> {
    const r = await this.db.query(
      `SELECT ${ANALYTICS_ERROR_GROUP_COLUMNS} FROM analytics_error_groups
       WHERE organization_id=$1 AND project_id=$2 AND fingerprint=$3
         AND $4=ANY(environments)
       LIMIT 1`,
      [orgId, projectId, fingerprint, environment],
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  async updateErrorGroupStatus(
    orgId: string,
    projectId: string,
    fingerprint: string,
    environment: string,
    status: string,
    assignedTo: string | null,
  ): Promise<Record<string, unknown> | null> {
    const r = await this.db.query(
      `UPDATE analytics_error_groups
          SET status=$5,
              assigned_to=COALESCE($6, assigned_to),
              resolved_at=CASE WHEN $5='resolved' THEN NOW() ELSE NULL END,
              resolved_by=CASE WHEN $5='resolved' THEN COALESCE($6, resolved_by) ELSE NULL END,
              updated_at=NOW()
       WHERE organization_id=$1 AND project_id=$2 AND fingerprint=$3
         AND $4=ANY(environments)
       RETURNING ${ANALYTICS_ERROR_GROUP_COLUMNS}`,
      [orgId, projectId, fingerprint, environment, status, assignedTo],
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  // ── Performance ──────────────────────────────────────────────────────────
  /** Route performance from the pre-aggregated summary; falls back to live compute. */
  async getRoutePerformance(orgId: string, projectId: string | undefined, environment: string | undefined, sinceDate: Date, limit: number): Promise<Array<Record<string, unknown>>> {
    const summary = await this.db.query(
      `SELECT route, method,
              MAX(p50_latency_ms) AS p50, MAX(p95_latency_ms) AS p95, MAX(p99_latency_ms) AS p99,
              SUM(request_count)::bigint AS request_count, AVG(error_rate) AS error_rate, AVG(apdex_score) AS apdex
       FROM analytics_performance_summary
       WHERE organization_id=$1 AND bucket_date >= $2::date AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       GROUP BY route, method
       ORDER BY request_count DESC
       LIMIT $5`,
      [orgId, sinceDate, projectId ?? null, environment ?? null, limit],
    );
    if (summary.rows.length > 0) return summary.rows as Array<Record<string, unknown>>;

    // Fallback: compute directly from events_requests (still single query).
    const live = await this.db.query(
      `SELECT route, method,
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
       LIMIT $5`,
      [orgId, sinceDate, projectId ?? null, environment ?? null, limit],
    );
    return live.rows as Array<Record<string, unknown>>;
  }

  async getLatencyDistribution(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(
      `SELECT width_bucket(latency_ms, 0, 5000, 50) AS bucket,
              MIN(latency_ms) AS min_ms, MAX(latency_ms) AS max_ms, COUNT(*)::bigint AS count
       FROM events_requests
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)
       GROUP BY bucket ORDER BY bucket ASC`,
      [orgId, range.from, range.to, projectId ?? null, environment ?? null],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  /** Raw counts needed for an Apdex score (T = satisfied threshold ms). */
  async getApdexCounts(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange, thresholdMs: number): Promise<{ satisfied: number; tolerating: number; total: number }> {
    const r = await this.db.query<{ satisfied: string; tolerating: string; total: string }>(
      `SELECT COUNT(*) FILTER (WHERE latency_ms <= $6)::bigint AS satisfied,
              COUNT(*) FILTER (WHERE latency_ms > $6 AND latency_ms <= $6*4)::bigint AS tolerating,
              COUNT(*)::bigint AS total
       FROM events_requests
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)`,
      [orgId, range.from, range.to, projectId ?? null, environment ?? null, thresholdMs],
    );
    const row = r.rows[0]!;
    return { satisfied: Number(row.satisfied), tolerating: Number(row.tolerating), total: Number(row.total) };
  }

  // ── Requests / traces ──────────────────────────────────────────────────
  async listRequests(orgId: string, range: TimeRange, filters: {
    projectId?: string; environment?: string; method?: string; statusCode?: number; route?: string; slowOnly?: boolean; errorOnly?: boolean; limit: number; offset: number;
  }): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
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
    const countRes = await this.db.query<{ count: string }>(countQ.sql, countQ.params);
    qb.orderBy('occurred_at', 'desc').paginate(filters.limit, filters.offset);
    const listQ = qb.select('id, event_id, request_id, url, method, status_code, latency_ms, route, trace_id, user_id, environment, is_slow, is_error, occurred_at');
    const listRes = await this.db.query(listQ.sql, listQ.params);
    return { rows: listRes.rows as Array<Record<string, unknown>>, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async getRequestById(
    orgId: string,
    id: string,
    projectId?: string,
    environment?: string,
  ): Promise<Record<string, unknown> | null> {
    const r = await this.db.query(
      `SELECT id, organization_id, project_id, environment, request_id, method, route, url, status_code, duration_ms, service, occurred_at
       FROM events_requests
       WHERE organization_id=$1 AND id=$2
         AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       LIMIT 1`,
      [orgId, id, projectId ?? null, environment ?? null],
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  async getSpansByTrace(
    orgId: string,
    traceId: string,
    projectId: string,
    environment: string,
    limit = 1000,
  ): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(
      `SELECT id, span_id, trace_id, parent_span_id, name, span_kind, span_status, start_time, end_time, duration_ms,
              http_method, http_route, http_status_code, db_system, db_operation, environment
       FROM events_spans
       WHERE organization_id=$1 AND trace_id=$2 AND project_id=$3 AND environment=$4
       ORDER BY start_time ASC
       LIMIT $5`,
      [orgId, traceId, projectId, environment, limit],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  async getTraceById(
    orgId: string,
    traceId: string,
    projectId: string,
    environment: string,
  ): Promise<Record<string, unknown> | null> {
    const r = await this.db.query(
      `SELECT id, organization_id, project_id, environment, trace_id, duration_ms, service, occurred_at
       FROM events_traces
       WHERE organization_id=$1 AND trace_id=$2 AND project_id=$3 AND environment=$4
       ORDER BY occurred_at DESC LIMIT 1`,
      [orgId, traceId, projectId, environment],
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  async listTraces(orgId: string, range: TimeRange, filters: {
    projectId?: string; environment?: string; traceId?: string; requestId?: string; service?: string;
    rootSpanName?: string; minDurationMs?: number; errorOnly?: boolean;
    limit: number; offset: number;
  }): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
    const conditions = ['t.organization_id=$1', 't.occurred_at >= $2', 't.occurred_at < $3'];
    const params: unknown[] = [orgId, range.from, range.to];
    if (filters.projectId) { params.push(filters.projectId); conditions.push(`t.project_id=$${params.length}`); }
    if (filters.environment) { params.push(filters.environment); conditions.push(`t.environment=$${params.length}`); }
    if (filters.traceId) { params.push(filters.traceId); conditions.push(`t.trace_id=$${params.length}`); }
    if (filters.requestId) { params.push(filters.requestId); conditions.push(`t.request_id=$${params.length}`); }
    if (filters.service) { params.push(filters.service); conditions.push(`t.service=$${params.length}`); }
    if (filters.rootSpanName) { params.push(`%${filters.rootSpanName}%`); conditions.push(`t.root_span_name ILIKE $${params.length}`); }
    if (filters.minDurationMs !== undefined) {
      params.push(filters.minDurationMs);
      conditions.push(`t.total_duration_ms >= $${params.length}`);
    }
    const errorPredicate = `EXISTS (
      SELECT 1 FROM events_spans s
      WHERE s.organization_id=t.organization_id AND s.project_id=t.project_id
        AND s.trace_id=t.trace_id AND s.environment=t.environment
        AND s.occurred_at >= t.occurred_at - INTERVAL '1 hour'
        AND s.occurred_at <= t.occurred_at + INTERVAL '24 hours'
        AND s.span_status='error'
    )`;
    if (filters.errorOnly) conditions.push(errorPredicate);
    const where = conditions.join(' AND ');
    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count FROM events_traces t WHERE ${where}`,
      params,
    );
    params.push(filters.limit, filters.offset);
    const rows = await this.db.query(
      `SELECT t.id, t.trace_id, t.root_span_name, t.root_span_id, t.span_count,
              t.total_duration_ms, t.request_id, t.service, t.environment, t.release,
              t.occurred_at, ${errorPredicate} AS has_error
       FROM events_traces t WHERE ${where}
       ORDER BY t.occurred_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { rows: rows.rows as Array<Record<string, unknown>>, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  // ── Metrics ─────────────────────────────────────────────────────────────
  async listMetricNames(orgId: string, projectId: string | undefined, environment: string | undefined, range: TimeRange): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(
      `SELECT metric_name, metric_type, COUNT(*)::bigint AS sample_count, MAX(occurred_at) AS last_seen
       FROM events_metrics
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)
       GROUP BY metric_name, metric_type ORDER BY metric_name ASC LIMIT 1000`,
      [orgId, range.from, range.to, projectId ?? null, environment ?? null],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  async getMetricSeries(orgId: string, name: string, range: TimeRange, bucket: TimeBucket, aggregate: string, projectId: string | undefined, environment: string | undefined): Promise<Array<Record<string, unknown>>> {
    // aggregate is validated by the route enum — safe to interpolate the fn name.
    const fn = ['avg', 'sum', 'min', 'max', 'count'].includes(aggregate) ? aggregate : 'avg';
    const expr = fn === 'count' ? 'COUNT(*)' : `${fn.toUpperCase()}(value)`;
    const r = await this.db.query(
      `SELECT DATE_TRUNC('${bucket}', occurred_at) AS bucket, ${expr}::float AS value
       FROM events_metrics
       WHERE organization_id=$1 AND metric_name=$2 AND occurred_at >= $3 AND occurred_at < $4
         AND ($5::uuid IS NULL OR project_id=$5)
         AND ($6::text IS NULL OR environment=$6)
       GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`,
      [orgId, name, range.from, range.to, projectId ?? null, environment ?? null],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  async getMetricStats(orgId: string, name: string, range: TimeRange, projectId: string | undefined, environment: string | undefined): Promise<Record<string, unknown> | null> {
    const r = await this.db.query(
      `SELECT COUNT(*)::bigint AS count, MIN(value)::float AS min, MAX(value)::float AS max, AVG(value)::float AS avg,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY value)::float AS p50,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)::float AS p95,
              PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY value)::float AS p99
       FROM events_metrics
       WHERE organization_id=$1 AND metric_name=$2 AND occurred_at >= $3 AND occurred_at < $4
         AND ($5::uuid IS NULL OR project_id=$5)
         AND ($6::text IS NULL OR environment=$6)`,
      [orgId, name, range.from, range.to, projectId ?? null, environment ?? null],
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  // ── Logs ─────────────────────────────────────────────────────────────────
  async listLogs(orgId: string, range: TimeRange, filters: {
    projectId?: string; environment?: string; level?: string; service?: string; search?: string; securityOnly?: boolean;
    limit: number; offset: number;
  }): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
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
    const countRes = await this.db.query<{ count: string }>(countQ.sql, countQ.params);
    qb.orderBy('occurred_at', 'desc').paginate(filters.limit, filters.offset);
    const listQ = qb.select(
      'id, event_id, level, message, logger, service, trace_id, span_id, request_id, environment, release, context, occurred_at',
    );
    const listRes = await this.db.query(listQ.sql, listQ.params);
    return { rows: listRes.rows as Array<Record<string, unknown>>, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async getLog(orgId: string, id: string): Promise<Record<string, unknown> | null> {
    const result = await this.db.query(
      `SELECT id, event_id, level, message, logger, service, trace_id, span_id, request_id,
              environment, release, context, tags, occurred_at
       FROM events_logs WHERE organization_id=$1 AND id=$2 LIMIT 1`,
      [orgId, id],
    );
    return (result.rows[0] as Record<string, unknown>) ?? null;
  }

  async summarizeLogs(orgId: string, range: TimeRange, filters: {
    projectId?: string; environment?: string; level?: string; service?: string; search?: string; limit: number;
  }): Promise<Array<Record<string, unknown>>> {
    const conditions = ['organization_id=$1', 'occurred_at >= $2', 'occurred_at < $3'];
    const params: unknown[] = [orgId, range.from, range.to];
    if (filters.projectId) { params.push(filters.projectId); conditions.push(`project_id=$${params.length}`); }
    if (filters.environment) { params.push(filters.environment); conditions.push(`environment=$${params.length}`); }
    if (filters.level) { params.push(filters.level); conditions.push(`level=$${params.length}`); }
    if (filters.service) { params.push(filters.service); conditions.push(`service=$${params.length}`); }
    if (filters.search) {
      params.push(filters.search);
      conditions.push(`to_tsvector('english', message) @@ plainto_tsquery('english', $${params.length})`);
    }
    params.push(Math.max(1, Math.min(filters.limit, 100)));
    const result = await this.db.query(
      `SELECT level, service, message, COUNT(*)::bigint AS occurrences, MAX(occurred_at) AS last_seen
       FROM events_logs
       WHERE ${conditions.join(' AND ')}
       GROUP BY level, service, message
       ORDER BY occurrences DESC, last_seen DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  async listObservedServices(
    orgId: string,
    range: TimeRange,
    projectId: string | undefined,
    environment: string | undefined,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const result = await this.db.query(
      `WITH per_source AS (
         SELECT project_id, service,
                COUNT(*)::bigint AS trace_count,
                0::bigint AS request_count,
                0::bigint AS log_count,
                MAX(occurred_at) AS last_seen
           FROM events_traces
          WHERE organization_id = $1 AND occurred_at >= $2 AND occurred_at < $3
            AND ($4::uuid IS NULL OR project_id = $4)
            AND ($5::text IS NULL OR environment = $5)
            AND service IS NOT NULL AND BTRIM(service) <> ''
          GROUP BY project_id, service

         UNION ALL

         SELECT project_id, service,
                0::bigint AS trace_count,
                COUNT(*)::bigint AS request_count,
                0::bigint AS log_count,
                MAX(occurred_at) AS last_seen
           FROM events_requests
          WHERE organization_id = $1 AND occurred_at >= $2 AND occurred_at < $3
            AND ($4::uuid IS NULL OR project_id = $4)
            AND ($5::text IS NULL OR environment = $5)
            AND service IS NOT NULL AND BTRIM(service) <> ''
          GROUP BY project_id, service

         UNION ALL

         SELECT project_id, service,
                0::bigint AS trace_count,
                0::bigint AS request_count,
                COUNT(*)::bigint AS log_count,
                MAX(occurred_at) AS last_seen
           FROM events_logs
          WHERE organization_id = $1 AND occurred_at >= $2 AND occurred_at < $3
            AND ($4::uuid IS NULL OR project_id = $4)
            AND ($5::text IS NULL OR environment = $5)
            AND service IS NOT NULL AND BTRIM(service) <> ''
          GROUP BY project_id, service
       )
       SELECT s.service, s.project_id, p.name AS project_name, p.slug AS project_slug,
              SUM(s.trace_count + s.request_count + s.log_count)::bigint AS observed_event_count,
              SUM(s.trace_count)::bigint AS trace_count,
              SUM(s.request_count)::bigint AS request_count,
              SUM(s.log_count)::bigint AS log_count,
              MAX(s.last_seen) AS last_seen
       FROM per_source s
       LEFT JOIN project_lookup p ON p.project_id = s.project_id AND p.organization_id = $1
       GROUP BY s.service, s.project_id, p.name, p.slug
       ORDER BY last_seen DESC
       LIMIT $6`,
      [orgId, range.from, range.to, projectId ?? null, environment ?? null, Math.max(1, Math.min(limit, 100))],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  async listServiceEndpoints(
    orgId: string,
    service: string,
    range: TimeRange,
    projectId: string | undefined,
    environment: string | undefined,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const result = await this.db.query(
      `SELECT route, method, COUNT(*)::bigint AS request_count,
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
       LIMIT $7`,
      [orgId, service, range.from, range.to, projectId ?? null, environment ?? null, Math.max(1, Math.min(limit, 100))],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  /** Logs newer than a cursor timestamp — used by the SSE poll loop. */
  async listLogsSince(orgId: string, since: Date, projectId: string | undefined, environment: string | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(
      `SELECT id, level, message, service, trace_id, environment, occurred_at FROM events_logs
       WHERE organization_id=$1 AND occurred_at > $2 AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       ORDER BY occurred_at ASC LIMIT $5`,
      [orgId, since, projectId ?? null, environment ?? null, limit],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  async listErrorsSince(orgId: string, since: Date, projectId: string | undefined, environment: string | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(
      `SELECT id, fingerprint, message, error_name, severity, service, environment, occurred_at FROM events_errors
       WHERE organization_id=$1 AND occurred_at > $2 AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       ORDER BY occurred_at ASC LIMIT $5`,
      [orgId, since, projectId ?? null, environment ?? null, limit],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  // ── Sessions / users ───────────────────────────────────────────────────
  async listSessions(orgId: string, range: TimeRange, filters: { projectId?: string; environment?: string; userId?: string; crashedOnly?: boolean; limit: number; offset: number }): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
    const conditions = ['organization_id=$1', 'started_at >= $2', 'started_at < $3'];
    const params: unknown[] = [orgId, range.from, range.to];
    if (filters.projectId) { params.push(filters.projectId); conditions.push(`project_id=$${params.length}`); }
    if (filters.environment) { params.push(filters.environment); conditions.push(`environment=$${params.length}`); }
    if (filters.userId) { params.push(filters.userId); conditions.push(`user_id=$${params.length}`); }
    if (filters.crashedOnly) conditions.push('is_crashed = true');
    const where = conditions.join(' AND ');
    const countRes = await this.db.query<{ count: string }>(`SELECT COUNT(*)::bigint AS count FROM analytics_user_sessions WHERE ${where}`, params);
    params.push(filters.limit, filters.offset);
    const r = await this.db.query(
      `SELECT ${ANALYTICS_USER_SESSION_COLUMNS} FROM analytics_user_sessions WHERE ${where} ORDER BY started_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { rows: r.rows as Array<Record<string, unknown>>, total: Number(countRes.rows[0]?.count ?? 0) };
  }

  async getSession(
    orgId: string,
    sessionId: string,
    projectId: string,
    environment: string,
  ): Promise<Record<string, unknown> | null> {
    const r = await this.db.query(
      `SELECT ${ANALYTICS_USER_SESSION_COLUMNS} FROM analytics_user_sessions
       WHERE organization_id=$1 AND session_id=$2 AND project_id=$3 AND environment=$4
       LIMIT 1`,
      [orgId, sessionId, projectId, environment],
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  async listUsers(orgId: string, range: TimeRange, projectId: string | undefined, environment: string | undefined, limit: number, offset: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(
      `SELECT user_id,
              COUNT(*)::bigint AS request_count,
              MAX(occurred_at) AS last_seen
       FROM events_requests
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND user_id IS NOT NULL AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)
       GROUP BY user_id ORDER BY request_count DESC LIMIT $6 OFFSET $7`,
      [orgId, range.from, range.to, projectId ?? null, environment ?? null, limit, offset],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  async getUserJourney(
    orgId: string,
    userId: string,
    range: TimeRange,
    projectId: string | undefined,
    environment: string | undefined,
    limit: number,
  ): Promise<{ errors: Array<Record<string, unknown>>; requests: Array<Record<string, unknown>> }> {
    const params = [orgId, userId, range.from, range.to, projectId ?? null, environment ?? null, limit];
    const [errors, requests] = await Promise.all([
      this.db.query(
        `SELECT id, error_name, message, severity, environment, occurred_at FROM events_errors
         WHERE organization_id=$1 AND user_id=$2 AND occurred_at >= $3 AND occurred_at < $4
           AND ($5::uuid IS NULL OR project_id=$5)
           AND ($6::text IS NULL OR environment=$6)
         ORDER BY occurred_at DESC LIMIT $7`,
        params,
      ),
      this.db.query(
        `SELECT id, method, route, status_code, latency_ms, environment, occurred_at FROM events_requests
         WHERE organization_id=$1 AND user_id=$2 AND occurred_at >= $3 AND occurred_at < $4
           AND ($5::uuid IS NULL OR project_id=$5)
           AND ($6::text IS NULL OR environment=$6)
         ORDER BY occurred_at DESC LIMIT $7`,
        params,
      ),
    ]);
    return { errors: errors.rows as Array<Record<string, unknown>>, requests: requests.rows as Array<Record<string, unknown>> };
  }

  // ── Crons ────────────────────────────────────────────────────────────────
  async listCrons(orgId: string, projectId: string | undefined, environment: string | undefined): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(
      `SELECT DISTINCT ON (monitor_slug) monitor_slug, status, duration_ms, occurred_at
       FROM events_cron_checkins
       WHERE organization_id=$1 AND ($2::uuid IS NULL OR project_id=$2)
         AND ($3::text IS NULL OR environment=$3)
       ORDER BY monitor_slug, occurred_at DESC`,
      [orgId, projectId ?? null, environment ?? null],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  async getCronHistory(
    orgId: string,
    slug: string,
    projectId: string | undefined,
    environment: string | undefined,
    limit: number,
    offset: number,
  ): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(
      `SELECT id, status, duration_ms, environment, occurred_at FROM events_cron_checkins
       WHERE organization_id=$1 AND monitor_slug=$2
         AND ($3::uuid IS NULL OR project_id=$3)
         AND ($4::text IS NULL OR environment=$4)
       ORDER BY occurred_at DESC LIMIT $5 OFFSET $6`,
      [orgId, slug, projectId ?? null, environment ?? null, limit, offset],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  // ── Dashboards CRUD ──────────────────────────────────────────────────────
  async createDashboard(input: { orgId: string; projectId: string | null; name: string; description: string | null; layout: Record<string, unknown>; widgets: unknown[]; isShared: boolean; createdBy: string }): Promise<Record<string, unknown>> {
    const r = await this.db.query(
      `INSERT INTO analytics_dashboards (organization_id, project_id, name, description, layout, widgets, is_shared, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${ANALYTICS_DASHBOARD_COLUMNS}`,
      [input.orgId, input.projectId, input.name, input.description, JSON.stringify(input.layout), JSON.stringify(input.widgets), input.isShared, input.createdBy],
    );
    return r.rows[0] as Record<string, unknown>;
  }

  async listDashboards(orgId: string, limit = 100): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(`SELECT ${ANALYTICS_DASHBOARD_COLUMNS} FROM analytics_dashboards WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`, [orgId, limit]);
    return r.rows as Array<Record<string, unknown>>;
  }

  async getDashboard(orgId: string, id: string): Promise<Record<string, unknown> | null> {
    const r = await this.db.query(`SELECT ${ANALYTICS_DASHBOARD_COLUMNS} FROM analytics_dashboards WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`, [orgId, id]);
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  async updateDashboard(orgId: string, id: string, fields: Record<string, unknown>, updatedBy: string): Promise<Record<string, unknown> | null> {
    const map: Record<string, string> = { name: 'name', description: 'description', layout: 'layout', widgets: 'widgets', isShared: 'is_shared' };
    const set: string[] = ['updated_by=$1']; const vals: unknown[] = [updatedBy];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || !map[k]) continue;
      vals.push(['layout', 'widgets'].includes(k) ? JSON.stringify(v) : v);
      set.push(`${map[k]}=$${vals.length}`);
    }
    vals.push(id, orgId);
    const r = await this.db.query(
      `UPDATE analytics_dashboards SET ${set.join(',')} WHERE id=$${vals.length - 1} AND organization_id=$${vals.length} AND deleted_at IS NULL RETURNING ${ANALYTICS_DASHBOARD_COLUMNS}`,
      vals,
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  async deleteDashboard(orgId: string, id: string): Promise<boolean> {
    const r = await this.db.query(`UPDATE analytics_dashboards SET deleted_at=NOW() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, orgId]);
    return (r.rowCount ?? 0) > 0;
  }

  // ── Saved queries CRUD ───────────────────────────────────────────────────
  async createSavedQuery(input: { orgId: string; projectId: string | null; name: string; description: string | null; queryType: string; queryConfig: Record<string, unknown>; visualizationType: string | null; visualizationConfig: Record<string, unknown>; createdBy: string }): Promise<Record<string, unknown>> {
    const r = await this.db.query(
      `INSERT INTO analytics_saved_queries (organization_id, project_id, name, description, query_type, query_config, visualization_type, visualization_config, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${ANALYTICS_SAVED_QUERY_COLUMNS}`,
      [input.orgId, input.projectId, input.name, input.description, input.queryType, JSON.stringify(input.queryConfig), input.visualizationType, JSON.stringify(input.visualizationConfig), input.createdBy],
    );
    return r.rows[0] as Record<string, unknown>;
  }

  async listSavedQueries(orgId: string, limit = 100): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(`SELECT ${ANALYTICS_SAVED_QUERY_COLUMNS} FROM analytics_saved_queries WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`, [orgId, limit]);
    return r.rows as Array<Record<string, unknown>>;
  }

  async getSavedQuery(orgId: string, id: string): Promise<Record<string, unknown> | null> {
    const r = await this.db.query(`SELECT ${ANALYTICS_SAVED_QUERY_COLUMNS} FROM analytics_saved_queries WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`, [orgId, id]);
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  async deleteSavedQuery(orgId: string, id: string): Promise<boolean> {
    const r = await this.db.query(`UPDATE analytics_saved_queries SET deleted_at=NOW() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, orgId]);
    return (r.rowCount ?? 0) > 0;
  }

  // ── Analytics alerts CRUD ────────────────────────────────────────────────
  async createAlert(input: { orgId: string; projectId: string | null; name: string; metric: string; operator: string; threshold: number; windowMinutes: number; notificationChannels: string[]; isActive: boolean; createdBy: string }): Promise<Record<string, unknown>> {
    const r = await this.db.query(
      `INSERT INTO analytics_alerts (organization_id, project_id, name, metric, operator, threshold, window_minutes, notification_channels, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5::analytics_alert_operator,$6,$7,$8,$9,$10) RETURNING ${ANALYTICS_ALERT_COLUMNS}`,
      [input.orgId, input.projectId, input.name, input.metric, input.operator, input.threshold, input.windowMinutes, JSON.stringify(input.notificationChannels), input.isActive, input.createdBy],
    );
    return r.rows[0] as Record<string, unknown>;
  }

  async listAlerts(orgId: string, limit = 100): Promise<Array<Record<string, unknown>>> {
    const r = await this.db.query(`SELECT ${ANALYTICS_ALERT_COLUMNS} FROM analytics_alerts WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`, [orgId, limit]);
    return r.rows as Array<Record<string, unknown>>;
  }

  async getAlert(orgId: string, id: string): Promise<Record<string, unknown> | null> {
    const r = await this.db.query(`SELECT ${ANALYTICS_ALERT_COLUMNS} FROM analytics_alerts WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`, [orgId, id]);
    return (r.rows[0] as Record<string, unknown>) ?? null;
  }

  async deleteAlert(orgId: string, id: string): Promise<boolean> {
    const r = await this.db.query(`UPDATE analytics_alerts SET deleted_at=NOW() WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, orgId]);
    return (r.rowCount ?? 0) > 0;
  }

  // ── Export ─────────────────────────────────────────────────────────────
  async exportDataset(orgId: string, dataset: 'errors' | 'requests' | 'logs' | 'metrics', range: TimeRange, projectId: string | undefined, environment: string | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
    const table = { errors: 'events_errors', requests: 'events_requests', logs: 'events_logs', metrics: 'events_metrics' }[dataset];
    const columns = {
      errors: 'id, organization_id, project_id, environment, event_id, error_name, message, severity, method, route, url, status_code, service, release, occurred_at',
      requests: 'id, organization_id, project_id, environment, request_id, method, route, url, status_code, duration_ms, service, occurred_at',
      logs: 'id, organization_id, project_id, environment, log_id, level, message, service, occurred_at',
      metrics: 'id, organization_id, project_id, environment, metric_name, metric_type, value, unit, occurred_at',
    }[dataset];
    const r = await this.db.query(
      `SELECT ${columns} FROM ${table}
       WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3 AND ($4::uuid IS NULL OR project_id=$4)
         AND ($5::text IS NULL OR environment=$5)
       ORDER BY occurred_at DESC LIMIT $6`,
      [orgId, range.from, range.to, projectId ?? null, environment ?? null, limit],
    );
    return r.rows as Array<Record<string, unknown>>;
  }

  // ── Rollup helpers (called by workers) ───────────────────────────────────
  async refreshHourlyRollup(orgId: string, startHour: Date, endHour: Date): Promise<void> {
    await this.db.query(`SELECT refresh_hourly_rollup($1, $2, $3)`, [orgId, startHour, endHour]);
  }

  async listOrgsWithRecentErrors(sinceHours: number): Promise<string[]> {
    const r = await this.db.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM events_errors WHERE created_at > NOW() - ($1 || ' hours')::interval LIMIT 1000`,
      [String(sinceHours)],
    );
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
  async refreshErrorGroups(orgId: string, sinceHours: number): Promise<void> {
    await this.db.query(
      `INSERT INTO analytics_error_groups
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
         updated_at = NOW()`,
      [orgId, String(sinceHours)],
    );
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

