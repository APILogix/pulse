/**
 * Dashboard read repository — rollup-only.
 *
 * Contract: docs/analytics/08-dashboard-api-contracts.md
 * Invariant: this file must never contain `FROM events_`. Dashboard reads come
 * exclusively from the `*_metrics_*` rollups and the analytics state tables
 * (docs/analytics/00-architecture-overview.md §2). The invariant is asserted by
 * test/unit/analytics-engine-read.test.ts, which reads this file's source.
 *
 * Raw event detail (single-event drill-downs, tailing lists) is served by a
 * separate repository so this boundary stays mechanically checkable.
 */
import { estimateUnion, fromBuffer } from '../hll.js';
import { mergeHistograms, parseHistogram, percentilesFromHistogram, histogramView } from '../histogram.js';
import { bucketExpression } from '../windows.js';
import { num, numOrNull, ratePct } from './formatters.js';
import { ALL_PROJECTS_SENTINEL } from '../types.js';
/** Tenant/time predicate shared by every rollup query. */
function scopeWhere(alias = 'r') {
    return `${alias}.organization_id = $1
      AND ${alias}.project_id  = $2
      AND ${alias}.environment = $3
      AND ${alias}.bucket     >= $4
      AND ${alias}.bucket     <  $5`;
}
function scopeParams(scope, range = scope.range) {
    return [
        scope.organizationId,
        scope.projectId ?? ALL_PROJECTS_SENTINEL,
        scope.environment,
        range.from,
        range.to,
    ];
}
function tableFor(base, window, available) {
    // Fall back to the coarsest available tier when the requested one does not
    // exist for this domain (e.g. runtime has no 5m tier).
    if (available.includes(window))
        return `${base}_${window}`;
    const order = ['1m', '5m', '1h', '1d'];
    const requestedIndex = order.indexOf(window);
    for (let index = requestedIndex; index >= 0; index -= 1) {
        const candidate = order[index];
        if (available.includes(candidate))
            return `${base}_${candidate}`;
    }
    return `${base}_${available[available.length - 1]}`;
}
const EMPTY_REQUEST_SUMMARY = {
    total: 0,
    success: 0,
    redirect: 0,
    clientError: 0,
    error: 0,
    authFailure: 0,
    rateLimited: 0,
    slow: 0,
    bot: 0,
    apdexSatisfied: 0,
    apdexTolerating: 0,
    bytesIn: 0,
    bytesOut: 0,
    latencySumMs: 0,
    latencyMaxMs: null,
    latencyHistogram: [],
    uniqueUsersExact: 0,
    uniqueUsersEstimate: 0,
    uniqueSessionsExact: 0,
    sampleCount: 0,
};
export class AnalyticsReadRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Aggregated request summary for a window.
     *
     * Counters are summed across buckets; the latency histogram is merged so the
     * percentiles are recomputed once over the whole range rather than averaging
     * per-bucket percentiles (which would be statistically wrong).
     */
    async requestSummary(scope, range = scope.range) {
        const table = tableFor('request_metrics', scope.window, ['1m', '5m', '1h', '1d']);
        const result = await this.pool.query(`SELECT COALESCE(SUM(r.total_count), 0)            AS total,
              COALESCE(SUM(r.success_count), 0)          AS success,
              COALESCE(SUM(r.redirect_count), 0)         AS redirect,
              COALESCE(SUM(r.client_error_count), 0)     AS client_error,
              COALESCE(SUM(r.error_count), 0)            AS error,
              COALESCE(SUM(r.auth_failure_count), 0)     AS auth_failure,
              COALESCE(SUM(r.rate_limited_count), 0)     AS rate_limited,
              COALESCE(SUM(r.slow_count), 0)             AS slow,
              COALESCE(SUM(r.bot_count), 0)              AS bot,
              COALESCE(SUM(r.apdex_satisfied_count), 0)  AS apdex_satisfied,
              COALESCE(SUM(r.apdex_tolerating_count), 0) AS apdex_tolerating,
              COALESCE(SUM(r.bytes_in), 0)               AS bytes_in,
              COALESCE(SUM(r.bytes_out), 0)              AS bytes_out,
              COALESCE(SUM(r.latency_sum_ms), 0)         AS latency_sum_ms,
              MAX(r.latency_max_ms)                      AS latency_max_ms,
              MAX(r.unique_users_exact)                  AS unique_users_exact,
              MAX(r.unique_sessions_exact)               AS unique_sessions_exact,
              COALESCE(SUM(r.sample_count), 0)           AS sample_count,
              ARRAY_AGG(r.latency_hist)     FILTER (WHERE r.latency_hist     IS NOT NULL) AS histograms,
              ARRAY_AGG(r.unique_users_hll) FILTER (WHERE r.unique_users_hll IS NOT NULL) AS sketches
         FROM ${table} r
        WHERE ${scopeWhere('r')}`, scopeParams(scope, range));
        const row = result.rows[0];
        if (!row)
            return { ...EMPTY_REQUEST_SUMMARY };
        const histograms = Array.isArray(row.histograms)
            ? row.histograms.map((entry) => parseHistogram(entry))
            : [];
        const sketches = Array.isArray(row.sketches)
            ? row.sketches.map((entry) => fromBuffer(entry))
            : [];
        return {
            total: num(row.total),
            success: num(row.success),
            redirect: num(row.redirect),
            clientError: num(row.client_error),
            error: num(row.error),
            authFailure: num(row.auth_failure),
            rateLimited: num(row.rate_limited),
            slow: num(row.slow),
            bot: num(row.bot),
            apdexSatisfied: num(row.apdex_satisfied),
            apdexTolerating: num(row.apdex_tolerating),
            bytesIn: num(row.bytes_in),
            bytesOut: num(row.bytes_out),
            latencySumMs: num(row.latency_sum_ms),
            latencyMaxMs: numOrNull(row.latency_max_ms),
            latencyHistogram: mergeHistograms(histograms),
            uniqueUsersExact: num(row.unique_users_exact),
            // Sketch union is the accurate cross-bucket distinct count; MAX(exact) is
            // the documented lower-bound fallback when no sketch was persisted.
            uniqueUsersEstimate: sketches.length > 0 ? estimateUnion(sketches) : num(row.unique_users_exact),
            uniqueSessionsExact: num(row.unique_sessions_exact),
            sampleCount: num(row.sample_count),
        };
    }
    /** Latency percentiles + distribution derived from the merged histogram. */
    latencyView(summary) {
        return {
            percentiles: percentilesFromHistogram(summary.latencyHistogram),
            buckets: histogramView(summary.latencyHistogram),
            avgMs: summary.total > 0 ? summary.latencySumMs / summary.total : null,
        };
    }
    /** Per-bucket series for one or more request counters. */
    async requestSeries(scope, metrics) {
        const table = tableFor('request_metrics', scope.window, ['1m', '5m', '1h', '1d']);
        const columnFor = {
            total: 'total_count',
            errors: 'error_count',
            client_errors: 'client_error_count',
            rate_limited: 'rate_limited_count',
            auth_failures: 'auth_failure_count',
            bytes_out: 'bytes_out',
        };
        const selected = metrics.filter((metric) => columnFor[metric] !== undefined);
        if (selected.length === 0)
            return new Map();
        const projections = selected
            .map((metric) => `COALESCE(SUM(r.${columnFor[metric]}), 0) AS ${metric}`)
            .join(',\n              ');
        const result = await this.pool.query(`SELECT r.bucket, ${projections}
         FROM ${table} r
        WHERE ${scopeWhere('r')}
        GROUP BY r.bucket
        ORDER BY r.bucket ASC`, scopeParams(scope));
        const out = new Map();
        for (const metric of selected)
            out.set(metric, []);
        for (const row of result.rows) {
            const bucket = new Date(row.bucket);
            for (const metric of selected) {
                out.get(metric).push({ bucket, value: num(row[metric]) });
            }
        }
        return out;
    }
    /** Latency percentile series, recomputed per bucket from stored histograms. */
    async latencySeries(scope) {
        const table = tableFor('request_metrics', scope.window, ['1m', '5m', '1h', '1d']);
        const result = await this.pool.query(`SELECT r.bucket,
              ARRAY_AGG(r.latency_hist) FILTER (WHERE r.latency_hist IS NOT NULL) AS histograms,
              AVG(r.latency_p50_ms) AS p50,
              AVG(r.latency_p75_ms) AS p75,
              AVG(r.latency_p90_ms) AS p90,
              AVG(r.latency_p95_ms) AS p95,
              AVG(r.latency_p99_ms) AS p99
         FROM ${table} r
        WHERE ${scopeWhere('r')}
        GROUP BY r.bucket
        ORDER BY r.bucket ASC`, scopeParams(scope));
        return result.rows.map((row) => {
            const histograms = Array.isArray(row.histograms)
                ? row.histograms.map((entry) => parseHistogram(entry))
                : [];
            if (histograms.length > 0) {
                const merged = mergeHistograms(histograms);
                const percentiles = percentilesFromHistogram(merged);
                return { bucket: new Date(row.bucket), ...percentiles };
            }
            // No histogram persisted: fall back to the stored percentile columns.
            return {
                bucket: new Date(row.bucket),
                p50: numOrNull(row.p50),
                p75: numOrNull(row.p75),
                p90: numOrNull(row.p90),
                p95: numOrNull(row.p95),
                p99: numOrNull(row.p99),
            };
        });
    }
    /** Top-N entity rollup rows for any Shape B table. */
    async topEntities(scope, params) {
        const table = tableFor(params.base, scope.window, params.available);
        const extra = params.extraColumns ?? [];
        const orderBy = params.orderBy ?? 'value';
        const direction = (params.direction ?? 'desc').toUpperCase();
        const extraProjections = extra
            .map((column) => {
            if (column.endsWith('_hist'))
                return `NULL::bigint[] AS ${column}`;
            // Text/label columns collapse to the newest value in the range.
            if (/^(entity_label|method|route|service|db_system|db_name|db_operation|db_collection|statement_pattern|dependency_kind|dependency_host|source_service|target_service|monitor_slug|last_status|country_code|country_name|region|dimension|dimension_value|error_name|message_template|mechanism|severity_max|gc_type|span_name|kind|metric_type|unit|release|sdk_name|sdk_version|lifecycle)$/.test(column)) {
                return `(ARRAY_AGG(r.${column} ORDER BY r.bucket DESC))[1] AS ${column}`;
            }
            if (/_p(50|75|90|95|99)_ms$/.test(column) || column.endsWith('_max_ms') || column.endsWith('_avg')) {
                return `MAX(r.${column}) AS ${column}`;
            }
            return `COALESCE(SUM(r.${column}), 0) AS ${column}`;
        })
            .join(',\n              ');
        const result = await this.pool.query(`SELECT r.entity_key,
              COALESCE(SUM(r.${params.valueColumn}), 0) AS value,
              COALESCE(SUM(r.sample_count), 0)         AS sample_count,
              ARRAY_AGG(r.latency_hist) FILTER (WHERE r.latency_hist IS NOT NULL) AS histograms
              ${extra.length > 0 ? `, ${extraProjections}` : ''}
         FROM ${table} r
        WHERE ${scopeWhere('r')}
          ${params.excludeOther ? "AND r.entity_key <> '__other__'" : ''}
        GROUP BY r.entity_key
        ORDER BY ${orderBy === 'value' ? 'value' : `"${orderBy}"`} ${direction} NULLS LAST
        LIMIT $6`, [...scopeParams(scope, params.range), scope.limit]);
        return result.rows.map((row) => {
            const histograms = Array.isArray(row.histograms)
                ? row.histograms.map((entry) => parseHistogram(entry))
                : [];
            const merged = histograms.length > 0 ? mergeHistograms(histograms) : null;
            return {
                ...row,
                histograms: undefined,
                latencyPercentiles: merged ? percentilesFromHistogram(merged) : null,
            };
        });
    }
    /** Error summary counters for a window. */
    async errorSummary(scope, range = scope.range) {
        const table = tableFor('error_metrics', scope.window, ['1m', '5m', '1h', '1d']);
        const result = await this.pool.query(`SELECT COALESCE(SUM(r.total_count), 0)   AS total,
              COALESCE(SUM(r.fatal_count), 0)   AS fatal,
              COALESCE(SUM(r.error_count), 0)   AS error,
              COALESCE(SUM(r.warning_count), 0) AS warning,
              MAX(r.unique_fingerprints)        AS unique_fingerprints,
              MAX(r.unique_users_exact)         AS affected_users,
              ARRAY_AGG(r.unique_users_hll) FILTER (WHERE r.unique_users_hll IS NOT NULL) AS sketches
         FROM ${table} r
        WHERE ${scopeWhere('r')}`, scopeParams(scope, range));
        const row = result.rows[0];
        if (!row) {
            return { total: 0, fatal: 0, error: 0, warning: 0, uniqueFingerprints: 0, affectedUsers: 0 };
        }
        const sketches = Array.isArray(row.sketches)
            ? row.sketches.map((entry) => fromBuffer(entry))
            : [];
        return {
            total: num(row.total),
            fatal: num(row.fatal),
            error: num(row.error),
            warning: num(row.warning),
            uniqueFingerprints: num(row.unique_fingerprints),
            affectedUsers: sketches.length > 0 ? estimateUnion(sketches) : num(row.affected_users),
        };
    }
    /**
     * Error groups: occurrence counts come from the rollups, triage state from
     * analytics_error_groups. This is the read-time join that replaces the
     * non-idempotent counter the worker used to maintain (DEVIATIONS.md D3).
     */
    async errorGroups(scope, filters) {
        const table = tableFor('error_group_metrics', scope.window, ['1m', '1h', '1d']);
        const params = scopeParams(scope);
        let index = params.length;
        const stateFilters = [];
        if (filters.status === 'resolved')
            stateFilters.push("g.status = 'resolved'");
        if (filters.status === 'unresolved')
            stateFilters.push("g.status <> 'resolved'");
        if (filters.mechanism) {
            params.push(filters.mechanism);
            stateFilters.push(`r.mechanism = $${++index}`);
        }
        params.push(scope.limit);
        const limitParam = ++index;
        const sortColumn = scope.sort?.column ?? 'occurrences';
        const sortDirection = (scope.sort?.direction ?? 'desc').toUpperCase();
        const sortExpression = sortColumn === 'lastSeen'
            ? 'last_seen_at'
            : sortColumn === 'firstSeen'
                ? 'first_seen_at'
                : sortColumn === 'users'
                    ? 'affected_users'
                    : sortColumn === 'regression'
                        ? 'regression_score'
                        : 'occurrences';
        const result = await this.pool.query(`WITH rolled AS (
         SELECT r.entity_key                                     AS fingerprint,
                COALESCE(SUM(r.occurrence_count), 0)             AS occurrences,
                MAX(r.unique_users_exact)                        AS affected_users,
                MAX(r.regression_score)                          AS regression_score,
                MIN(r.first_seen_at)                             AS first_seen_at,
                MAX(r.last_seen_at)                              AS last_seen_at,
                (ARRAY_AGG(r.entity_label ORDER BY r.bucket DESC))[1]     AS error_name,
                (ARRAY_AGG(r.message_template ORDER BY r.bucket DESC))[1] AS message_template,
                (ARRAY_AGG(r.mechanism ORDER BY r.bucket DESC))[1]        AS mechanism,
                (ARRAY_AGG(r.severity_max ORDER BY r.bucket DESC))[1]     AS severity,
                MAX(r.service_count)                             AS service_count,
                BOOL_OR(r.is_new_in_window)                      AS is_new,
                ARRAY_AGG(r.unique_users_hll) FILTER (WHERE r.unique_users_hll IS NOT NULL) AS sketches
           FROM ${table} r
          WHERE ${scopeWhere('r')}
          GROUP BY r.entity_key
       )
       SELECT rolled.*,
              g.status,
              g.priority,
              g.assigned_to,
              g.resolved_at,
              g.services,
              g.environments,
              g.releases
         FROM rolled
         LEFT JOIN analytics_error_groups g
                ON g.organization_id = $1
               AND g.fingerprint     = rolled.fingerprint
        WHERE TRUE ${stateFilters.length > 0 ? `AND ${stateFilters.join(' AND ')}` : ''}
        ORDER BY ${sortExpression} ${sortDirection} NULLS LAST
        LIMIT $${limitParam}`, params);
        return result.rows.map((row) => {
            const sketches = Array.isArray(row.sketches)
                ? row.sketches.map((entry) => fromBuffer(entry))
                : [];
            return {
                ...row,
                sketches: undefined,
                affected_users: sketches.length > 0 ? estimateUnion(sketches) : num(row.affected_users),
            };
        });
    }
    /** Service fleet rows for the health tiles and the service catalog. */
    async services(scope) {
        const table = tableFor('service_metrics', scope.window, ['1m', '5m', '1h', '1d']);
        const result = await this.pool.query(`SELECT r.entity_key                              AS service,
              COALESCE(SUM(r.total_count), 0)           AS total_count,
              COALESCE(SUM(r.error_count), 0)           AS error_count,
              COALESCE(SUM(r.client_error_count), 0)    AS client_error_count,
              COALESCE(SUM(r.apdex_satisfied_count), 0) AS apdex_satisfied,
              COALESCE(SUM(r.apdex_tolerating_count), 0) AS apdex_tolerating,
              AVG(r.availability_pct)                   AS availability_pct,
              AVG(r.health_score)                       AS health_score,
              (ARRAY_AGG(r.release_current ORDER BY r.bucket DESC))[1] AS release_current,
              ARRAY_AGG(r.latency_hist) FILTER (WHERE r.latency_hist IS NOT NULL) AS histograms
         FROM ${table} r
        WHERE ${scopeWhere('r')}
        GROUP BY r.entity_key
        ORDER BY total_count DESC
        LIMIT $6`, [...scopeParams(scope), scope.limit]);
        return result.rows.map((row) => {
            const histograms = Array.isArray(row.histograms)
                ? row.histograms.map((entry) => parseHistogram(entry))
                : [];
            const merged = histograms.length > 0 ? mergeHistograms(histograms) : null;
            const total = num(row.total_count);
            return {
                service: row.service,
                total_count: total,
                error_count: num(row.error_count),
                error_rate_pct: ratePct(num(row.error_count), total),
                availability_pct: numOrNull(row.availability_pct),
                health_score: numOrNull(row.health_score),
                release_current: row.release_current,
                apdex: total > 0
                    ? (num(row.apdex_satisfied) + num(row.apdex_tolerating) / 2) / total
                    : null,
                latencyPercentiles: merged ? percentilesFromHistogram(merged) : null,
            };
        });
    }
    /** Log level counters. */
    async logSummary(scope, range = scope.range) {
        const table = tableFor('log_metrics', scope.window, ['1m', '5m', '1h', '1d']);
        const result = await this.pool.query(`SELECT COALESCE(SUM(r.total_count), 0) AS total,
              COALESCE(SUM(r.error_count), 0) AS error,
              COALESCE(SUM(r.warn_count), 0)  AS warn,
              COALESCE(SUM(r.info_count), 0)  AS info,
              COALESCE(SUM(r.debug_count), 0) AS debug
         FROM ${table} r
        WHERE ${scopeWhere('r')}`, scopeParams(scope, range));
        const row = result.rows[0];
        return {
            total: num(row?.total),
            error: num(row?.error),
            warn: num(row?.warn),
            info: num(row?.info),
            debug: num(row?.debug),
        };
    }
    /** Trace summary counters. */
    async traceSummary(scope, range = scope.range) {
        const table = tableFor('trace_metrics', scope.window, ['1m', '5m', '1h']);
        const result = await this.pool.query(`SELECT COALESCE(SUM(r.trace_count), 0)       AS traces,
              COALESCE(SUM(r.partial_count), 0)     AS partial,
              COALESCE(SUM(r.error_trace_count), 0) AS error_traces,
              COALESCE(SUM(r.span_count_sum), 0)    AS span_count_sum,
              ARRAY_AGG(r.duration_hist) FILTER (WHERE r.duration_hist IS NOT NULL) AS histograms
         FROM ${table} r
        WHERE ${scopeWhere('r')}`, scopeParams(scope, range));
        const row = result.rows[0];
        const histograms = Array.isArray(row?.histograms)
            ? row.histograms.map((entry) => parseHistogram(entry))
            : [];
        return {
            traces: num(row?.traces),
            partial: num(row?.partial),
            errorTraces: num(row?.error_traces),
            spanCountSum: num(row?.span_count_sum),
            durationHistogram: mergeHistograms(histograms),
        };
    }
    /** Latency heatmap: bucket × latency-band counts for the distribution chart. */
    async latencyHeatmap(scope) {
        const table = tableFor('request_metrics', scope.window, ['1m', '5m', '1h', '1d']);
        const result = await this.pool.query(`SELECT r.bucket,
              ARRAY_AGG(r.latency_hist) FILTER (WHERE r.latency_hist IS NOT NULL) AS histograms
         FROM ${table} r
        WHERE ${scopeWhere('r')}
        GROUP BY r.bucket
        ORDER BY r.bucket ASC`, scopeParams(scope));
        return result.rows.map((row) => ({
            bucket: new Date(row.bucket),
            histogram: mergeHistograms(Array.isArray(row.histograms)
                ? row.histograms.map((entry) => parseHistogram(entry))
                : []),
        }));
    }
    /** Project health cards for project lists. */
    async projectHealth(organizationId, limit = 100) {
        const result = await this.pool.query(`SELECT DISTINCT ON (project_id)
              project_id, environment, bucket, request_count, error_count,
              error_rate_pct, latency_p95_ms, availability_pct, open_alert_count,
              health_score, status
         FROM project_health_5m
        WHERE organization_id = $1
          AND environment = '__all__'
          AND bucket >= NOW() - INTERVAL '1 hour'
        ORDER BY project_id, bucket DESC
        LIMIT $2`, [organizationId, limit]);
        return result.rows;
    }
    /** Bucket expression helper exposed for the raw-detail repository's reuse. */
    static bucketExpressionFor(column, window) {
        return bucketExpression(column, window);
    }
}
//# sourceMappingURL=dashboard.repository.js.map