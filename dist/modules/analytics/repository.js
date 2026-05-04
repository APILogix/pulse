import { pool } from "../../config/database.js";
export class AnalyticsRepository {
    db;
    maxLimit = 100;
    constructor(db = pool) {
        this.db = db;
    }
    async listEvents(projectId, query) {
        const limit = this.clampLimit(query.limit);
        const params = [projectId, query.from, query.to];
        const where = ["e.project_id = $1", "e.timestamp BETWEEN $2 AND $3"];
        let index = params.length;
        if (query.type) {
            params.push(query.type);
            where.push(`e.type = $${++index}`);
        }
        if (query.statusCode !== undefined) {
            params.push(query.statusCode);
            where.push(`re.status_code = $${++index}`);
        }
        if (query.method) {
            params.push(query.method.toUpperCase());
            where.push(`re.method = $${++index}`);
        }
        if (query.searchQuery) {
            params.push(`%${query.searchQuery}%`);
            where.push(`(e.payload::text ILIKE $${++index} OR ee.message ILIKE $${index} OR re.url ILIKE $${index})`);
        }
        const cursor = this.decodeCursor(query.cursor);
        if (cursor) {
            params.push(cursor.timestamp, cursor.id);
            const operator = query.sort === "asc" ? ">" : "<";
            where.push(`(e.timestamp, e.id) ${operator} ($${++index}, $${++index})`);
        }
        const order = query.sort === "asc" ? "ASC" : "DESC";
        params.push(limit + 1);
        const limitParam = ++index;
        const whereSql = where.join(" AND ");
        return this.withProjectContext(projectId, async (client) => {
            const start = Date.now();
            // 🔒 enforce max limit
            const safeLimit = Math.min(limit ?? 50, 100);
            // ⚠️ fetch one extra row for pagination detection
            const listQuery = `
    SELECT
      e.id,
      e.type,
      e.timestamp,
      re.method,
      re.url,
      re.status_code,
      re.latency_ms,
      (ee.event_id IS NOT NULL) AS has_error
    FROM events e
    LEFT JOIN request_events re
      ON re.event_id = e.id AND re.project_id = e.project_id
    LEFT JOIN error_events ee
      ON ee.event_id = e.id AND ee.project_id = e.project_id
    WHERE ${whereSql}
    ORDER BY e.timestamp ${order}, e.id ${order}
    LIMIT $${limitParam}
  `;
            // ❌ count query is expensive → make optional
            const shouldFetchCount = false;
            const [items, count] = await Promise.all([
                client.query(listQuery, params),
                shouldFetchCount
                    ? client.query(`
            SELECT COUNT(*)::int AS total
            FROM events e
            WHERE ${whereSql}
          `, params.slice(0, -1))
                    : Promise.resolve(null),
            ]);
            const rows = items.rows;
            // pagination logic
            const hasMore = rows.length > safeLimit;
            const data = rows.slice(0, safeLimit);
            const last = data.at(-1);
            const response = {
                data: data.map((row) => ({
                    id: row.id,
                    type: row.type,
                    timestamp: row.timestamp,
                    method: row.method,
                    url: row.url,
                    statusCode: row.status_code,
                    latencyMs: row.latency_ms,
                    hasError: row.has_error,
                })),
                hasMore,
                nextCursor: hasMore && last ? this.encodeCursor(last.timestamp, last.id) : null,
                queryTimeMs: Date.now() - start,
            };
            if (count) {
                response.totalEstimated = Number(count.rows[0]?.total ?? 0);
            }
            return response;
        });
    }
    async getEventDetails(projectId, eventId) {
        return this.withProjectContext(projectId, async (client) => {
            const [base, request, error, trace] = await Promise.all([
                client.query("SELECT * FROM events WHERE project_id = $1 AND id = $2 LIMIT 1", [projectId, eventId]),
                client.query("SELECT * FROM request_events WHERE project_id = $1 AND event_id = $2 LIMIT 1", [projectId, eventId]),
                client.query("SELECT * FROM error_events WHERE project_id = $1 AND event_id = $2 LIMIT 1", [projectId, eventId]),
                client.query(`
            SELECT id, type, timestamp, payload
            FROM events
            WHERE project_id = $1
              AND request_id = (SELECT request_id FROM events WHERE project_id = $1 AND id = $2)
            ORDER BY timestamp ASC
          `, [projectId, eventId]),
            ]);
            if (!base.rows[0]) {
                return null;
            }
            return {
                base: base.rows[0],
                request: request.rows[0] ?? null,
                error: error.rows[0] ?? null,
                trace: trace.rows,
            };
        });
    }
    async getRequestOverview(projectId, range) {
        return this.one(projectId, `
      SELECT jsonb_build_object(
        'total_requests', COUNT(*),
        'avg_latency_ms', COALESCE(ROUND(AVG(latency_ms)), 0),
        'p95_latency_ms', COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0),
        'error_count', COUNT(*) FILTER (WHERE status_code >= 500),
        'error_rate_pct', COALESCE(ROUND(COUNT(*) FILTER (WHERE status_code >= 500) * 100.0 / NULLIF(COUNT(*), 0), 2), 0),
        'unique_users', COUNT(DISTINCT user_id)
      ) AS data
      FROM request_events
      WHERE project_id = $1 AND timestamp BETWEEN $2 AND $3
    `, [projectId, range.from, range.to]);
    }
    async getDashboard(projectId, range) {
        return this.withProjectContext(projectId, async (client) => {
            const [requests, errors, endpoints, topErrors, status] = await Promise.all([
                this.queryData(client, `
          SELECT jsonb_build_object(
            'total', COUNT(*),
            'avg_latency_ms', COALESCE(ROUND(AVG(latency_ms)), 0),
            'p95_latency_ms', COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0),
            'error_rate_pct', COALESCE(ROUND(COUNT(*) FILTER (WHERE status_code >= 500) * 100.0 / NULLIF(COUNT(*), 0), 2), 0)
          ) AS data
          FROM request_events
          WHERE project_id = $1 AND timestamp BETWEEN $2 AND $3
        `, [projectId, range.from, range.to]),
                this.queryData(client, `
          SELECT jsonb_build_object(
            'total', COUNT(*),
            'unresolved', COUNT(*) FILTER (WHERE is_resolved = FALSE),
            'critical', COUNT(*) FILTER (WHERE priority = 1 AND is_resolved = FALSE)
          ) AS data
          FROM error_groups
          WHERE project_id = $1 AND last_seen BETWEEN $2 AND $3
        `, [projectId, range.from, range.to]),
                this.queryRows(client, `
          SELECT md5(COALESCE(url, '') || COALESCE(method, '')) AS endpoint_hash,
                 url, method, COUNT(*)::int AS requests,
                 COALESCE(ROUND(AVG(latency_ms)), 0)::int AS avg_latency_ms
          FROM request_events
          WHERE project_id = $1 AND timestamp BETWEEN $2 AND $3 AND url IS NOT NULL
          GROUP BY url, method
          ORDER BY requests DESC
          LIMIT 10
        `, [projectId, range.from, range.to]),
                this.queryRows(client, `
          SELECT fingerprint, error_type, last_message, occurrences, priority, is_resolved, last_seen
          FROM error_groups
          WHERE project_id = $1 AND last_seen BETWEEN $2 AND $3
          ORDER BY occurrences DESC
          LIMIT 10
        `, [projectId, range.from, range.to]),
                this.queryData(client, `
          SELECT jsonb_build_object(
            '2xx', COUNT(*) FILTER (WHERE status_code BETWEEN 200 AND 299),
            '3xx', COUNT(*) FILTER (WHERE status_code BETWEEN 300 AND 399),
            '4xx', COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499),
            '5xx', COUNT(*) FILTER (WHERE status_code >= 500)
          ) AS data
          FROM request_events
          WHERE project_id = $1 AND timestamp BETWEEN $2 AND $3
        `, [projectId, range.from, range.to]),
            ]);
            return {
                requests,
                errors,
                topEndpoints: endpoints,
                topErrors,
                statusDistribution: status,
                generatedAt: new Date().toISOString(),
            };
        });
    }
    async listErrorGroups(projectId, query) {
        const limit = this.clampLimit(query.limit);
        const params = [projectId];
        const where = ["project_id = $1"];
        let index = params.length;
        if (query.status === "resolved") {
            where.push("is_resolved = TRUE");
        }
        else if (query.status === "unresolved") {
            where.push("is_resolved = FALSE");
        }
        if (query.priority !== undefined) {
            params.push(query.priority);
            where.push(`priority = $${++index}`);
        }
        if (query.cursor) {
            params.push(query.cursor);
            where.push(`last_seen < $${++index}`);
        }
        params.push(limit + 1);
        const limitParam = ++index;
        const whereSql = where.join(" AND ");
        return this.withProjectContext(projectId, async (client) => {
            const [items, count] = await Promise.all([
                client.query(`
            SELECT *
            FROM error_groups
            WHERE ${whereSql}
            ORDER BY last_seen DESC
            LIMIT $${limitParam}
          `, params),
                client.query(`SELECT COUNT(*)::int AS total FROM error_groups WHERE ${whereSql}`, params.slice(0, -1)),
            ]);
            const data = items.rows.slice(0, limit);
            const last = data.at(-1);
            return {
                data,
                totalEstimated: Number(count.rows[0]?.total ?? 0),
                hasMore: items.rows.length > limit,
                nextCursor: items.rows.length > limit && last
                    ? new Date(last.last_seen).toISOString()
                    : null,
                queryTimeMs: 0,
            };
        });
    }
    async updateErrorGroup(projectId, fingerprint, update) {
        const sets = ["updated_at = NOW()"];
        const params = [projectId, fingerprint];
        let index = params.length;
        if (update.priority !== undefined) {
            params.push(update.priority);
            sets.push(`priority = $${++index}`);
        }
        if (update.isResolved !== undefined) {
            params.push(update.isResolved);
            sets.push(`is_resolved = $${++index}`);
            sets.push(`resolved_at = CASE WHEN $${index} THEN NOW() ELSE NULL END`);
        }
        return this.withProjectContext(projectId, async (client) => {
            const result = await client.query(`
          UPDATE error_groups
          SET ${sets.join(", ")}
          WHERE project_id = $1 AND fingerprint = $2
          RETURNING *
        `, params);
            return result.rows[0] ?? null;
        });
    }
    async checkHealth(projectId) {
        try {
            await this.withProjectContext(projectId, (client) => client.query("SELECT 1"));
            return true;
        }
        catch {
            return false;
        }
    }
    async one(projectId, sql, params) {
        return this.withProjectContext(projectId, async (client) => this.queryData(client, sql, params));
    }
    async queryData(client, sql, params) {
        const result = await client.query(sql, params);
        return result.rows[0]?.data ?? null;
    }
    async queryRows(client, sql, params) {
        const result = await client.query(sql, params);
        return result.rows;
    }
    async withProjectContext(projectId, callback) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.current_project_id', $1, true)", [projectId]);
            const result = await callback(client);
            await client.query("COMMIT");
            return result;
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    clampLimit(limit) {
        return Math.max(1, Math.min(limit, this.maxLimit));
    }
    encodeCursor(timestamp, id) {
        const payload = {
            timestamp: new Date(timestamp).toISOString(),
            id,
        };
        return Buffer.from(JSON.stringify(payload)).toString("base64url");
    }
    decodeCursor(cursor) {
        if (!cursor) {
            return null;
        }
        try {
            return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=repository.js.map