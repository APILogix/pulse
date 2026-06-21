/**
 * TelemetryReader — reads persisted telemetry from migrations 013/014 tables.
 * Pairs with TelemetryWriter; replaces legacy events/error_events queries.
 */
import { randomUUID } from 'crypto';
const REPLAY_TYPE_TABLES = [
    { type: 'error', table: 'errors' },
    { type: 'request', table: 'requests' },
    { type: 'span', table: 'spans' },
    { type: 'trace', table: 'traces' },
    { type: 'metric', table: 'metrics' },
    { type: 'log', table: 'logs' },
    { type: 'message', table: 'messages' },
    { type: 'profile', table: 'profiles' },
    { type: 'cron_checkin', table: 'cron_checkins' },
    { type: 'replay', table: 'replays' },
];
export class TelemetryReader {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async listErrorEvents(query) {
        return this.withProjectContext(query.projectId, async (client) => {
            const params = [query.projectId];
            const where = ['e.project_id = $1'];
            let index = params.length;
            if (query.from) {
                params.push(query.from);
                where.push(`e.timestamp >= $${++index}`);
            }
            if (query.to) {
                params.push(query.to);
                where.push(`e.timestamp <= $${++index}`);
            }
            if (query.fingerprint) {
                params.push(query.fingerprint);
                where.push(`e.fingerprint = $${++index}`);
            }
            if (query.errorType) {
                params.push(query.errorType);
                where.push(`e.error_type = $${++index}`);
            }
            if (query.resolved !== undefined) {
                where.push(query.resolved ? 'e.resolved_at IS NOT NULL' : 'e.resolved_at IS NULL');
            }
            const whereSql = where.join(' AND ');
            const countParams = [...params];
            params.push(query.limit, query.offset);
            const limitParam = ++index;
            const offsetParam = ++index;
            const list = await client.query(`
          SELECT
            e.id,
            e.project_id,
            e.org_id,
            e.request_id,
            e.message,
            e.error_type,
            e.fingerprint,
            e.stack,
            e.context,
            e.breadcrumbs,
            e.severity,
            e.timestamp,
            e.ingested_at,
            e.resolved_at,
            e.resolved_by
          FROM errors e
          WHERE ${whereSql}
          ORDER BY e.timestamp DESC, e.id DESC
          LIMIT $${limitParam}
          OFFSET $${offsetParam}
        `, params);
            const count = await client.query(`SELECT COUNT(*)::int AS total FROM errors e WHERE ${whereSql}`, countParams);
            const total = Number(count.rows[0]?.total ?? 0);
            return {
                data: list.rows.map((row) => this.mapErrorRow(row)),
                total,
                limit: query.limit,
                offset: query.offset,
                hasMore: query.offset + list.rows.length < total,
            };
        });
    }
    async getErrorEventById(errorId, projectId) {
        return this.withProjectContext(projectId, async (client) => {
            const result = await client.query(`
          SELECT
            e.id,
            e.project_id,
            e.org_id,
            e.request_id,
            e.message,
            e.error_type,
            e.fingerprint,
            e.stack,
            e.context,
            e.breadcrumbs,
            e.severity,
            e.timestamp,
            e.ingested_at,
            e.resolved_at,
            e.resolved_by
          FROM errors e
          WHERE e.project_id = $1 AND e.id = $2
          LIMIT 1
        `, [projectId, errorId]);
            const row = result.rows[0];
            return row ? this.mapErrorRow(row) : null;
        });
    }
    async getEventById(eventId, projectId) {
        const client = await this.pool.connect();
        try {
            for (const { type, table } of REPLAY_TYPE_TABLES) {
                const result = await client.query(`SELECT * FROM ${table} WHERE id = $1 AND project_id = $2 LIMIT 1`, [eventId, projectId]);
                if (result.rows.length > 0) {
                    return { type, ...result.rows[0], details: result.rows[0] };
                }
            }
            return null;
        }
        finally {
            client.release();
        }
    }
    async getEventsForReplay(projectId, startTime, endTime, eventTypes, maxEvents = 10_000) {
        const safeMax = Number.isFinite(maxEvents) && maxEvents > 0
            ? Math.min(Math.trunc(maxEvents), 100_000)
            : 10_000;
        const allowed = new Set((eventTypes?.length ? eventTypes : REPLAY_TYPE_TABLES.map((t) => t.type)));
        const collected = [];
        for (const { type, table } of REPLAY_TYPE_TABLES) {
            if (!allowed.has(type))
                continue;
            if (collected.length >= safeMax)
                break;
            const remaining = safeMax - collected.length;
            const rows = await this.pool.query(`SELECT * FROM ${table}
         WHERE project_id = $1 AND timestamp BETWEEN $2 AND $3
         ORDER BY timestamp ASC
         LIMIT $4`, [projectId, startTime, endTime, remaining]);
            for (const row of rows.rows) {
                const normalized = this.rowToNormalizedEvent(type, row);
                if (!normalized)
                    continue;
                const item = {
                    id: String(row.id),
                    type,
                    projectId,
                    orgId: row.org_id ? String(row.org_id) : '',
                    receivedAt: Date.now(),
                    batchId: `replay-${Date.now()}`,
                    payload: normalized,
                };
                if (row.request_id)
                    item.requestId = String(row.request_id);
                if (row.ingested_at) {
                    item.ingestedAt = new Date(row.ingested_at).toISOString();
                }
                collected.push(item);
            }
        }
        collected.sort((a, b) => new Date(a.payload.timestamp ?? 0).getTime() -
            new Date(b.payload.timestamp ?? 0).getTime());
        return collected.slice(0, safeMax);
    }
    mapErrorRow(row) {
        const timestampMs = new Date(row.timestamp).getTime();
        const payload = {
            type: 'error',
            requestId: row.request_id ?? randomUUID(),
            message: row.message,
            name: row.error_type,
            stack: Array.isArray(row.stack) ? row.stack : [],
            fingerprint: row.fingerprint,
            timestamp: timestampMs,
            context: row.context ?? {},
        };
        return {
            id: row.id,
            eventId: row.id,
            projectId: row.project_id,
            requestId: row.request_id,
            message: row.message,
            errorType: row.error_type,
            fingerprint: row.fingerprint,
            stack: row.stack,
            context: row.context,
            metadata: { severity: row.severity, breadcrumbs: row.breadcrumbs },
            timestamp: new Date(row.timestamp).toISOString(),
            createdAt: new Date(row.ingested_at).toISOString(),
            resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
            resolvedBy: row.resolved_by,
            ingestedAt: new Date(row.ingested_at).toISOString(),
            payload,
        };
    }
    rowToNormalizedEvent(type, row) {
        const ts = new Date(row.timestamp).getTime();
        switch (type) {
            case 'error':
                return {
                    type: 'error',
                    message: String(row.message ?? ''),
                    name: String(row.error_type ?? 'UnknownError'),
                    fingerprint: String(row.fingerprint ?? ''),
                    stack: row.stack,
                    context: row.context,
                    requestId: row.request_id ? String(row.request_id) : undefined,
                    timestamp: ts,
                };
            case 'request':
                return {
                    type: 'request',
                    requestId: String(row.request_id ?? row.id),
                    url: String(row.url ?? ''),
                    method: String(row.method ?? 'GET'),
                    statusCode: Number(row.status_code ?? 0),
                    latency: Number(row.latency_ms ?? 0),
                    headers: row.headers,
                    query: row.query,
                    bodySize: row.body_size != null ? Number(row.body_size) : undefined,
                    userId: row.user_id ? String(row.user_id) : null,
                    timestamp: ts,
                };
            case 'metric':
                return {
                    type: 'metric',
                    metricName: String(row.metric_name ?? ''),
                    metricType: row.metric_type ?? 'gauge',
                    value: row.value != null ? Number(row.value) : undefined,
                    unit: row.unit ? String(row.unit) : undefined,
                    tags: row.tags,
                    timestamp: ts,
                };
            case 'log':
                return {
                    type: 'log',
                    level: String(row.level ?? 'info'),
                    message: String(row.message ?? ''),
                    requestId: row.request_id ? String(row.request_id) : undefined,
                    timestamp: ts,
                };
            default:
                return { type, timestamp: ts, ...row };
        }
    }
    async withProjectContext(projectId, callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.current_project_id', $1, true)", [projectId]);
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => { });
            throw err;
        }
        finally {
            client.release();
        }
    }
}
//# sourceMappingURL=telemetry-reader.js.map