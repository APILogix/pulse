import { pool } from "../../../config/database.js";
const USAGE_TABLES = {
    minute: "project_usage_minute",
    hourly: "project_usage_hourly",
    daily: "project_usage_daily",
};
const SUMMARY_COLUMNS = [
    "COALESCE(SUM(total_events),0)::text AS total_events",
    "COALESCE(SUM(errors),0)::text AS errors",
    "COALESCE(SUM(requests),0)::text AS requests",
    "COALESCE(SUM(transactions),0)::text AS transactions",
    "COALESCE(SUM(traces),0)::text AS traces",
    "COALESCE(SUM(spans),0)::text AS spans",
    "COALESCE(SUM(logs),0)::text AS logs",
    "COALESCE(SUM(metrics),0)::text AS metrics",
    "COALESCE(SUM(profiles),0)::text AS profiles",
    "COALESCE(SUM(ai_events),0)::text AS ai_events",
    "COALESCE(SUM(sdk_requests),0)::text AS sdk_requests",
    "COALESCE(MAX(active_api_keys),0)::text AS active_api_keys",
    "COALESCE(MAX(active_environments),0)::text AS active_environments",
    "COALESCE(MAX(active_users),0)::text AS active_users",
    "COALESCE(MAX(active_members),0)::text AS active_members",
    "COALESCE(SUM(alert_count),0)::text AS alert_count",
    "COALESCE(SUM(connector_deliveries),0)::text AS connector_deliveries",
    "COALESCE(SUM(failed_notifications),0)::text AS failed_notifications",
    "COALESCE(SUM(rate_limit_usage),0)::text AS rate_limit_usage",
    "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms_p50)::text AS latency_ms_p50",
    "PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms_p95)::text AS latency_ms_p95",
    "PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms_p99)::text AS latency_ms_p99",
].join(", ");
const TIME_SERIES_COLUMNS = [
    "bucket",
    "COALESCE(SUM(total_events),0)::text AS total_events",
    "COALESCE(SUM(errors),0)::text AS errors",
    "COALESCE(SUM(requests),0)::text AS requests",
    "COALESCE(SUM(transactions),0)::text AS transactions",
    "COALESCE(SUM(traces),0)::text AS traces",
    "COALESCE(SUM(spans),0)::text AS spans",
    "COALESCE(SUM(logs),0)::text AS logs",
    "COALESCE(SUM(metrics),0)::text AS metrics",
    "COALESCE(SUM(profiles),0)::text AS profiles",
    "COALESCE(SUM(ai_events),0)::text AS ai_events",
    "COALESCE(SUM(sdk_requests),0)::text AS sdk_requests",
    "COALESCE(MAX(active_api_keys),0)::text AS active_api_keys",
    "COALESCE(MAX(active_environments),0)::text AS active_environments",
    "COALESCE(MAX(active_users),0)::text AS active_users",
    "COALESCE(MAX(active_members),0)::text AS active_members",
    "COALESCE(SUM(alert_count),0)::text AS alert_count",
    "COALESCE(SUM(connector_deliveries),0)::text AS connector_deliveries",
    "COALESCE(SUM(failed_notifications),0)::text AS failed_notifications",
    "COALESCE(SUM(rate_limit_usage),0)::text AS rate_limit_usage",
    "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms_p50)::text AS latency_ms_p50",
    "PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms_p95)::text AS latency_ms_p95",
    "PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms_p99)::text AS latency_ms_p99",
].join(", ");
export class UsageAnalyticsRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    whereClause(projectId, query, skipBucket = false) {
        const params = [projectId];
        const conditions = ["project_id = $1"];
        let i = 1;
        if (!skipBucket) {
            i += 1;
            params.push(query.from);
            conditions.push(`bucket >= $${i}`);
            i += 1;
            params.push(query.to);
            conditions.push(`bucket <= $${i}`);
        }
        if (query.environmentId) {
            i += 1;
            params.push(query.environmentId);
            conditions.push(`environment_id = $${i}`);
        }
        if (query.apiKeyId) {
            i += 1;
            params.push(query.apiKeyId);
            conditions.push(`api_key_id = $${i}`);
        }
        return { sql: conditions.join(" AND "), params };
    }
    async getSummary(projectId, query, client) {
        const db = client ?? this.db;
        const table = USAGE_TABLES[this.pickGranularity(query)];
        const { sql, params } = this.whereClause(projectId, query);
        const result = await db.query(`SELECT ${SUMMARY_COLUMNS}
         FROM ${table}
        WHERE ${sql}`, params);
        return this.mapSummaryRow(result.rows[0]);
    }
    async getTimeSeries(projectId, query, client) {
        const db = client ?? this.db;
        const table = USAGE_TABLES[this.pickGranularity(query)];
        const { sql, params } = this.whereClause(projectId, query);
        const limit = query.limit;
        const offset = query.cursor ? Number.parseInt(Buffer.from(query.cursor, "base64").toString("utf8"), 10) : query.offset;
        const result = await db.query(`SELECT ${TIME_SERIES_COLUMNS}
         FROM ${table}
        WHERE ${sql}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}`, [...params, limit + 1, offset]);
        const rows = result.rows;
        const hasMore = rows.length > limit;
        const points = (hasMore ? rows.slice(0, -1) : rows).map((row) => this.mapTimeSeriesRow(row));
        return { points, hasMore };
    }
    async getCalendarHeatmap(projectId, from, to, environmentId, apiKeyId, client) {
        const db = client ?? this.db;
        const params = [projectId, from, to];
        const conditions = ["project_id = $1", "bucket >= $2", "bucket <= $3"];
        if (environmentId) {
            params.push(environmentId);
            conditions.push(`environment_id = $${params.length}`);
        }
        if (apiKeyId) {
            params.push(apiKeyId);
            conditions.push(`api_key_id = $${params.length}`);
        }
        const result = await db.query(`SELECT DATE(bucket) AS date, COALESCE(SUM(total_events),0)::text AS total_events
         FROM project_usage_daily
        WHERE ${conditions.join(" AND ")}
        GROUP BY DATE(bucket)
        ORDER BY date ASC`, params);
        return {
            type: "calendar",
            cells: result.rows.map((row) => ({
                x: row.date,
                y: "events",
                value: Number.parseInt(row.total_events, 10),
            })),
        };
    }
    async getHourlyHeatmap(projectId, from, to, environmentId, apiKeyId, client) {
        const db = client ?? this.db;
        const params = [projectId, from, to];
        const conditions = ["project_id = $1", "bucket >= $2", "bucket <= $3"];
        if (environmentId) {
            params.push(environmentId);
            conditions.push(`environment_id = $${params.length}`);
        }
        if (apiKeyId) {
            params.push(apiKeyId);
            conditions.push(`api_key_id = $${params.length}`);
        }
        const result = await db.query(`SELECT EXTRACT(HOUR FROM bucket)::int AS hour,
              EXTRACT(DOW FROM bucket)::int AS dow,
              COALESCE(SUM(total_events),0)::text AS total_events
         FROM project_usage_hourly
        WHERE ${conditions.join(" AND ")}
        GROUP BY hour, dow
        ORDER BY hour, dow`, params);
        return {
            type: "hourly",
            cells: result.rows.map((row) => ({
                x: `${row.hour}:00`,
                y: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][row.dow] ?? String(row.dow),
                value: Number.parseInt(row.total_events, 10),
            })),
        };
    }
    async getDayOfWeekHeatmap(projectId, from, to, environmentId, apiKeyId, client) {
        const db = client ?? this.db;
        const params = [projectId, from, to];
        const conditions = ["project_id = $1", "bucket >= $2", "bucket <= $3"];
        if (environmentId) {
            params.push(environmentId);
            conditions.push(`environment_id = $${params.length}`);
        }
        if (apiKeyId) {
            params.push(apiKeyId);
            conditions.push(`api_key_id = $${params.length}`);
        }
        const result = await db.query(`SELECT EXTRACT(DOW FROM bucket)::int AS dow,
              COALESCE(SUM(total_events),0)::text AS total_events
         FROM project_usage_daily
        WHERE ${conditions.join(" AND ")}
        GROUP BY dow
        ORDER BY dow`, params);
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return {
            type: "dayOfWeek",
            cells: result.rows.map((row) => ({
                x: days[row.dow] ?? String(row.dow),
                y: "events",
                value: Number.parseInt(row.total_events, 10),
            })),
        };
    }
    async getTopList(projectId, dimension, from, to, environmentId, apiKeyId, limit = 10, client) {
        const db = client ?? this.db;
        const fieldMap = {
            endpoint: "top_endpoints",
            service: "top_services",
            errorGroup: "top_error_groups",
            sdkVersion: "top_sdk_versions",
            country: "top_countries",
            browser: "top_browsers",
            os: "top_os",
            device: "top_devices",
            release: "top_releases",
        };
        const field = fieldMap[dimension] ?? "top_endpoints";
        const params = [projectId, from, to];
        const conditions = ["project_id = $1", "bucket >= $2", "bucket <= $3"];
        if (environmentId) {
            params.push(environmentId);
            conditions.push(`environment_id = $${params.length}`);
        }
        if (apiKeyId) {
            params.push(apiKeyId);
            conditions.push(`api_key_id = $${params.length}`);
        }
        const result = await db.query(`SELECT key,
              COALESCE(SUM((value->>'events')::bigint),0)::text AS total_events,
              COALESCE(SUM((value->>'errors')::bigint),0)::text AS errors,
              COALESCE(SUM((value->>'requests')::bigint),0)::text AS requests
         FROM (
           SELECT jsonb_each(${field}) AS entry, total_events
             FROM project_usage_daily
            WHERE ${conditions.join(" AND ")}
         ) sub,
         LATERAL (SELECT entry.key, entry.value) AS kv(key, value)
         GROUP BY key
         ORDER BY total_events DESC
         LIMIT $${params.length + 1}`, [...params, limit]);
        return result.rows.map((row) => ({
            key: row.key,
            totalEvents: Number.parseInt(row.total_events, 10),
            errors: Number.parseInt(row.errors, 10),
            requests: Number.parseInt(row.requests, 10),
        }));
    }
    async getComparison(projectId, dimension, from, to, limit = 10, client) {
        const db = client ?? this.db;
        const groupColumn = dimension === "environment" ? "environment_id" : "api_key_id";
        const idColumn = dimension === "environment" ? "environment_id" : "api_key_id";
        const result = await db.query(`SELECT COALESCE(${idColumn}::text, 'unknown') AS id,
              bucket,
              COALESCE(SUM(total_events),0)::text AS total_events,
              COALESCE(SUM(errors),0)::text AS errors,
              COALESCE(SUM(requests),0)::text AS requests
         FROM project_usage_hourly
        WHERE project_id = $1
          AND bucket >= $2
          AND bucket <= $3
          AND ${groupColumn} IS NOT NULL
        GROUP BY ${groupColumn}, bucket
        ORDER BY ${groupColumn}, bucket ASC`, [projectId, from, to]);
        const seriesById = new Map();
        for (const row of result.rows) {
            const series = seriesById.get(row.id) ?? { id: row.id, name: row.id, data: [] };
            series.data.push({
                bucket: row.bucket.toISOString(),
                totalEvents: Number.parseInt(row.total_events, 10),
                errors: Number.parseInt(row.errors, 10),
                requests: Number.parseInt(row.requests, 10),
                transactions: 0,
                traces: 0,
                spans: 0,
                logs: 0,
                metrics: 0,
                profiles: 0,
                aiEvents: 0,
                sdkRequests: 0,
                activeApiKeys: 0,
                activeEnvironments: 0,
                activeUsers: 0,
                activeMembers: 0,
                alertCount: 0,
                connectorDeliveries: 0,
                failedNotifications: 0,
                rateLimitUsage: 0,
                latencyMsP50: null,
                latencyMsP95: null,
                latencyMsP99: null,
            });
            seriesById.set(row.id, series);
        }
        return [...seriesById.values()].slice(0, limit);
    }
    async getMonthlyUsageVsPlan(projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT year_month, total_events::text, total_bytes::text,
              api_key_requests::text, rate_limited_events::text,
              alert_notifications::text, active_users::text
         FROM project_usage_monthly
        WHERE project_id = $1
        ORDER BY year_month DESC`, [projectId]);
        return result.rows.map((row) => ({
            yearMonth: row.year_month,
            totalEvents: Number.parseInt(row.total_events, 10),
            totalBytes: Number.parseInt(row.total_bytes, 10),
            apiKeyRequests: Number.parseInt(row.api_key_requests, 10),
            rateLimitedEvents: Number.parseInt(row.rate_limited_events, 10),
            alertNotifications: Number.parseInt(row.alert_notifications, 10),
            activeUsers: Number.parseInt(row.active_users, 10),
            planLimit: null,
            usagePercent: null,
        }));
    }
    pickGranularity(query) {
        const diffMs = query.to.getTime() - query.from.getTime();
        if (diffMs <= 1000 * 60 * 60)
            return "minute"; // <= 1 hour
        if (diffMs <= 1000 * 60 * 60 * 24 * 7)
            return "hourly"; // <= 7 days
        return "daily";
    }
    mapSummaryRow(row) {
        return {
            totalEvents: Number.parseInt(row.total_events, 10),
            errors: Number.parseInt(row.errors, 10),
            requests: Number.parseInt(row.requests, 10),
            transactions: Number.parseInt(row.transactions, 10),
            traces: Number.parseInt(row.traces, 10),
            spans: Number.parseInt(row.spans, 10),
            logs: Number.parseInt(row.logs, 10),
            metrics: Number.parseInt(row.metrics, 10),
            profiles: Number.parseInt(row.profiles, 10),
            aiEvents: Number.parseInt(row.ai_events, 10),
            sdkRequests: Number.parseInt(row.sdk_requests, 10),
            activeApiKeys: Number.parseInt(row.active_api_keys, 10),
            activeEnvironments: Number.parseInt(row.active_environments, 10),
            activeUsers: Number.parseInt(row.active_users, 10),
            activeMembers: Number.parseInt(row.active_members, 10),
            alertCount: Number.parseInt(row.alert_count, 10),
            connectorDeliveries: Number.parseInt(row.connector_deliveries, 10),
            failedNotifications: Number.parseInt(row.failed_notifications, 10),
            rateLimitUsage: Number.parseInt(row.rate_limit_usage, 10),
            latencyMsP50: row.latency_ms_p50 ? Number.parseFloat(row.latency_ms_p50) : null,
            latencyMsP95: row.latency_ms_p95 ? Number.parseFloat(row.latency_ms_p95) : null,
            latencyMsP99: row.latency_ms_p99 ? Number.parseFloat(row.latency_ms_p99) : null,
        };
    }
    mapTimeSeriesRow(row) {
        return {
            bucket: row.bucket.toISOString(),
            totalEvents: Number.parseInt(row.total_events, 10),
            errors: Number.parseInt(row.errors, 10),
            requests: Number.parseInt(row.requests, 10),
            transactions: Number.parseInt(row.transactions, 10),
            traces: Number.parseInt(row.traces, 10),
            spans: Number.parseInt(row.spans, 10),
            logs: Number.parseInt(row.logs, 10),
            metrics: Number.parseInt(row.metrics, 10),
            profiles: Number.parseInt(row.profiles, 10),
            aiEvents: Number.parseInt(row.ai_events, 10),
            sdkRequests: Number.parseInt(row.sdk_requests, 10),
            activeApiKeys: Number.parseInt(row.active_api_keys, 10),
            activeEnvironments: Number.parseInt(row.active_environments, 10),
            activeUsers: Number.parseInt(row.active_users, 10),
            activeMembers: Number.parseInt(row.active_members, 10),
            alertCount: Number.parseInt(row.alert_count, 10),
            connectorDeliveries: Number.parseInt(row.connector_deliveries, 10),
            failedNotifications: Number.parseInt(row.failed_notifications, 10),
            rateLimitUsage: Number.parseInt(row.rate_limit_usage, 10),
            latencyMsP50: row.latency_ms_p50 ? Number.parseFloat(row.latency_ms_p50) : null,
            latencyMsP95: row.latency_ms_p95 ? Number.parseFloat(row.latency_ms_p95) : null,
            latencyMsP99: row.latency_ms_p99 ? Number.parseFloat(row.latency_ms_p99) : null,
        };
    }
}
//# sourceMappingURL=analytics.repository.js.map