/**
 * Postgres writer for ingestion workers and lookup endpoints.
 *
 * Flow:
 * 1. API-key authentication reads project_api_keys joined to projects and
 *    returns only active, unexpired credentials.
 * 2. Worker writes first insert the shared events row, then insert type-specific
 *    child rows such as request_events or error_events in the same logical path.
 * 3. Debug and replay reads use project-scoped queries so callers can inspect or
 *    requeue historical telemetry without crossing tenant boundaries.
 */
import {} from 'pg';
export class PostgresWriter {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Resolve project by API key hash.
     * Joins project_api_keys -> projects with active checks.
     */
    async getProjectByApiKeyHash(keyHash) {
        const client = await this.pool.connect();
        try {
            const result = await client.query(`
        SELECT 
          p.id as project_id,
          p.org_id,
          p.name as project_name,
          p.status as project_status,
          k.environment,
          k.id as key_id,
          k.is_active,
          k.expires_at
        FROM project_api_keys k
        INNER JOIN projects p ON p.id = k.project_id
        WHERE k.key_hash = $1
          AND k.is_active = true
          AND (k.expires_at IS NULL OR k.expires_at > NOW())
          AND p.status = 'active'
        LIMIT 1
      `, [keyHash]);
            if (result.rows.length === 0)
                return null;
            const row = result.rows[0];
            return {
                projectId: row.project_id,
                orgId: row.org_id,
                projectName: row.project_name,
                projectStatus: row.project_status,
                environment: row.environment,
                apiKeyId: row.key_id,
                isActive: row.is_active,
                expiresAt: row.expires_at,
            };
        }
        finally {
            client.release();
        }
    }
    /** Fire-and-forget last_used update (never block ingestion) */
    async updateApiKeyLastUsed(apiKeyId) {
        try {
            await this.pool.query('UPDATE project_api_keys SET last_used_at = NOW() WHERE id = $1', [apiKeyId]);
        }
        catch {
            // Non-critical: silently fail
        }
    }
    /** Batch write to partitioned events table */
    async writeEvents(events) {
        // Bulk insert through UNNEST keeps one database round trip per batch and
        // ON CONFLICT protects replay/retry paths from duplicate event ids.
        const firstEvent = events[0];
        if (!firstEvent)
            return;
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const projectId = firstEvent.projectId;
            console.log("Porejct id 2", projectId);
            await client.query(`SET LOCAL app.current_project_id = '${projectId}'`);
            console.log(events, "while writting events");
            const query = `
        INSERT INTO events (
          id, project_id, type, request_id, timestamp, payload, ingested_at
        ) 
        SELECT * FROM UNNEST(
          $1::uuid[], $2::uuid[], $3::varchar[], $4::uuid[], 
          $5::timestamptz[], $6::jsonb[], $7::timestamptz[]
        )
      `;
            const ids = events.map((e) => e.id);
            const projectIds = events.map((e) => e.projectId);
            const types = events.map((e) => e.type);
            const requestIds = events.map((e) => e.requestId || null);
            const timestamps = events.map((e) => new Date(e.payload.timestamp).toISOString());
            const payloads = events.map((e) => JSON.stringify(e.payload));
            const ingestedAts = events.map(() => new Date().toISOString());
            await client.query(query, [
                ids,
                projectIds,
                types,
                requestIds,
                timestamps,
                payloads,
                ingestedAts,
            ]);
            console.log("query complte ");
            await client.query('COMMIT');
        }
        catch (err) {
            await client.query('ROLLBACK');
            console.log(err);
            throw err;
        }
        finally {
            client.release();
        }
    }
    /** Write request events to child partitioned table */
    async writeRequestEvents(events) {
        // Request events are written after the canonical events rows so the generic
        // event stream and request-specific analytics stay in sync.
        const firstEvent = events[0];
        if (!firstEvent)
            return;
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const projectId = firstEvent.projectId;
            console.log("project id", projectId);
            await client.query(`SET LOCAL app.current_project_id = '${projectId}'`);
            console.log("before send to event writer", events);
            await this.writeEvents(events);
            const query = `
        INSERT INTO request_events (
          event_id, project_id, request_id, url, method, status_code, 
          latency_ms, body_size_bytes, user_id, ip_address, user_agent, timestamp
        )
        SELECT * FROM UNNEST(
          $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::varchar[],
          $6::int[], $7::int[], $8::int[], $9::text[], $10::inet[], $11::text[], $12::timestamptz[]
        )
      `;
            const payloads = events.map((e) => e.payload);
            await client.query(query, [
                events.map((e) => e.id),
                events.map((e) => e.projectId),
                events.map((e) => e.requestId || null),
                payloads.map((p) => p.url),
                payloads.map((p) => p.method),
                payloads.map((p) => p.statusCode),
                payloads.map((p) => p.latency),
                payloads.map((p) => p.bodySize || 0),
                payloads.map((p) => p.userId),
                payloads.map((p) => null),
                payloads.map((p) => JSON.stringify(p.headers)),
                payloads.map((p) => new Date(p.timestamp).toISOString()),
            ]);
            await client.query('COMMIT');
        }
        catch (err) {
            await client.query('ROLLBACK');
            console.log("err occured after simple event", err);
            throw err;
        }
        finally {
            client.release();
        }
    }
    /** Write error events — error_groups handled by DB trigger */
    async writeErrorEvents(events) {
        // Error events keep the full payload in events and denormalize searchable
        // error fields into error_events; grouping can then be handled by triggers.
        const firstEvent = events[0];
        if (!firstEvent)
            return;
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const projectId = firstEvent.projectId;
            await client.query(`SET LOCAL app.current_project_id = '${projectId}'`);
            await this.writeEvents(events);
            const query = `
        INSERT INTO error_events (
          event_id, project_id, request_id, message, error_type, 
          fingerprint, stack, context, metadata, timestamp
        )
        SELECT * FROM UNNEST(
          $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::varchar[],
          $6::varchar[], $7::jsonb[], $8::jsonb[], $9::jsonb[], $10::timestamptz[]
        )
      `;
            const payloads = events.map((e) => e.payload);
            await client.query(query, [
                events.map((e) => e.id),
                events.map((e) => e.projectId),
                events.map((e) => e.requestId || null),
                payloads.map((p) => p.message),
                payloads.map((p) => (typeof p.name === 'string' ? p.name : 'UnknownError')),
                payloads.map((p) => p.fingerprint),
                payloads.map((p) => JSON.stringify(p.stack || [])),
                payloads.map((p) => JSON.stringify(p.context || {})),
                payloads.map((p) => JSON.stringify({ sdkVersion: 'unknown' })),
                payloads.map((p) => new Date(p.timestamp).toISOString()),
            ]);
            await client.query('COMMIT');
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    async listErrorEvents(query) {
        return this.withProjectContext(query.projectId, async (client) => {
            const params = [query.projectId];
            const where = ['ee.project_id = $1'];
            let index = params.length;
            if (query.from) {
                params.push(query.from);
                where.push(`ee.timestamp >= $${++index}`);
            }
            if (query.to) {
                params.push(query.to);
                where.push(`ee.timestamp <= $${++index}`);
            }
            if (query.fingerprint) {
                params.push(query.fingerprint);
                where.push(`ee.fingerprint = $${++index}`);
            }
            if (query.errorType) {
                params.push(query.errorType);
                where.push(`ee.error_type = $${++index}`);
            }
            if (query.resolved !== undefined) {
                where.push(query.resolved
                    ? 'ee.resolved_at IS NOT NULL'
                    : 'ee.resolved_at IS NULL');
            }
            const whereSql = where.join(' AND ');
            const countParams = [...params];
            params.push(query.limit, query.offset);
            const limitParam = ++index;
            const offsetParam = ++index;
            const list = await client.query(`
          SELECT
            ee.id,
            ee.event_id,
            ee.project_id,
            ee.request_id,
            ee.message,
            ee.error_type,
            ee.fingerprint,
            ee.stack,
            ee.context,
            ee.metadata,
            ee.timestamp,
            ee.created_at,
            ee.resolved_at,
            ee.resolved_by,
            e.ingested_at,
            e.payload
          FROM error_events ee
          INNER JOIN events e
            ON e.id = ee.event_id AND e.project_id = ee.project_id
          WHERE ${whereSql}
          ORDER BY ee.timestamp DESC, ee.id DESC
          LIMIT $${limitParam}
          OFFSET $${offsetParam}
        `, params);
            const count = await client.query(`SELECT COUNT(*)::int AS total FROM error_events ee WHERE ${whereSql}`, countParams);
            const total = Number(count.rows[0]?.total ?? 0);
            return {
                data: list.rows.map((row) => this.mapErrorEvent(row)),
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
            ee.id,
            ee.event_id,
            ee.project_id,
            ee.request_id,
            ee.message,
            ee.error_type,
            ee.fingerprint,
            ee.stack,
            ee.context,
            ee.metadata,
            ee.timestamp,
            ee.created_at,
            ee.resolved_at,
            ee.resolved_by,
            e.ingested_at,
            e.payload
          FROM error_events ee
          INNER JOIN events e
            ON e.id = ee.event_id AND e.project_id = ee.project_id
          WHERE ee.project_id = $1
            AND (ee.id = $2 OR ee.event_id = $2)
          LIMIT 1
        `, [projectId, errorId]);
            const row = result.rows[0];
            return row ? this.mapErrorEvent(row) : null;
        });
    }
    /** Debug endpoint: fetch full event graph */
    async getEventById(eventId, projectId) {
        // Debug lookup returns the base event plus child-table details based on type,
        // which gives operators one endpoint for full event inspection.
        const client = await this.pool.connect();
        try {
            await client.query(`SET LOCAL app.current_project_id = '${projectId}'`);
            const event = await client.query('SELECT * FROM events WHERE id = $1 AND project_id = $2', [eventId, projectId]);
            if (event.rows.length === 0)
                return null;
            const result = { ...event.rows[0] };
            if (result.type === 'request') {
                const req = await client.query('SELECT * FROM request_events WHERE event_id = $1', [eventId]);
                result.details = req.rows[0] || null;
            }
            else if (result.type === 'error') {
                const err = await client.query('SELECT * FROM error_events WHERE event_id = $1', [eventId]);
                result.details = err.rows[0] || null;
            }
            return result;
        }
        finally {
            client.release();
        }
    }
    /** Replay: fetch historical events by time range */
    async getEventsForReplay(projectId, startTime, endTime, eventTypes) {
        // Replay reads a bounded, ordered time window and rebuilds EnrichedEvent-like
        // payloads so the queue worker can process them through the standard path.
        const client = await this.pool.connect();
        try {
            await client.query(`SET LOCAL app.current_project_id = '${projectId}'`);
            let query = `
        SELECT 
          id, 
          project_id as "projectId", 
          type, 
          request_id as "requestId",
          timestamp, 
          payload,
          ingested_at as "ingestedAt"
        FROM events 
        WHERE project_id = $1 
        AND timestamp BETWEEN $2 AND $3
      `;
            const params = [projectId, startTime, endTime];
            if (eventTypes && eventTypes.length > 0) {
                query += ` AND type = ANY($4::varchar[])`;
                params.push(eventTypes);
            }
            query += ` ORDER BY timestamp ASC LIMIT 10000`;
            const result = await client.query(query, params);
            return result.rows.map((row) => ({
                id: row.id,
                type: row.type,
                projectId: row.projectId,
                orgId: '',
                requestId: row.requestId,
                receivedAt: Date.now(),
                ingestedAt: row.ingestedAt,
                batchId: `replay-${Date.now()}`,
                payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            }));
        }
        finally {
            client.release();
        }
    }
    async healthCheck() {
        try {
            await this.pool.query('SELECT 1');
            return true;
        }
        catch {
            return false;
        }
    }
    mapErrorEvent(row) {
        const payload = typeof row.payload === 'string'
            ? JSON.parse(row.payload)
            : row.payload;
        return {
            id: row.id,
            eventId: row.event_id,
            projectId: row.project_id,
            requestId: row.request_id,
            message: row.message,
            errorType: row.error_type,
            fingerprint: row.fingerprint,
            stack: row.stack,
            context: row.context,
            metadata: row.metadata,
            timestamp: new Date(row.timestamp).toISOString(),
            createdAt: new Date(row.created_at).toISOString(),
            resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
            resolvedBy: row.resolved_by,
            ingestedAt: row.ingested_at ? new Date(row.ingested_at).toISOString() : null,
            payload,
        };
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
//# sourceMappingURL=postgress.writter.js.map