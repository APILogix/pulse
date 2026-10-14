import { logDB } from '../../config/log-database.js';
import { pool } from '../../config/database.js';
import { isPublicId } from '../../shared/utils/public-id-generator.js';
import { buildDetailProjection, buildPublicProjection, projectPublicRow, } from './query-engine/index.js';
import { errorsResource } from './resources/index.js';
/** Columns that may be used as a correlation key. Fixed allow-list. */
export const CORRELATION_COLUMNS = [
    'trace_id',
    'request_id',
    'span_id',
    'parent_span_id',
    'session_id',
    'user_id',
];
export class ObservabilityRepository {
    /** Execute engine-generated SQL on the read path. */
    async run(sql, params) {
        const result = await logDB.queryWithRetry(sql, params, { operation: 'read' });
        return result.rows;
    }
    /**
     * Fetch rows of a resource correlated by a fixed key column within the
     * tenant + time window. The column is validated against
     * {@link CORRELATION_COLUMNS}; every value is bound as a parameter.
     */
    async fetchCorrelated(input) {
        if (!CORRELATION_COLUMNS.includes(input.column)) {
            throw new Error(`Illegal correlation column: ${input.column}`);
        }
        const { resource, ctx } = input;
        const limit = Math.max(1, Math.min(Math.trunc(input.limit), 100));
        const params = [ctx.organizationId, input.value, input.from, input.to];
        let sql = `SELECT ${buildPublicProjection(resource)} FROM ${resource.table}
               WHERE organization_id = $1 AND ${input.column} = $2
               AND ${resource.timeColumn} >= $3 AND ${resource.timeColumn} < $4`;
        sql += this.projectPredicate(ctx, params);
        if (input.excludeId) {
            params.push(input.excludeId);
            sql += ` AND ${resource.idColumn} <> $${params.length}`;
        }
        params.push(limit);
        sql += ` ORDER BY ${resource.timeColumn} ASC LIMIT $${params.length}`;
        const rows = await this.run(sql, params);
        return rows.map((row) => resource.mapRow(row));
    }
    /**
     * Fetch a single row by id or public_id, returning the raw row (all columns) so detail
     * assembly can read correlation keys the projection would omit.
     */
    async fetchRawById(resource, ctx, id) {
        const isPubId = isPublicId(id);
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const params = [ctx.organizationId, id];
        let filterClause;
        if (resource.name === 'requests' && /^TRC-\d{1,12}$/i.test(id.trim())) {
            filterClause = `trace_id = (
        SELECT t.trace_id
        FROM events_traces t
        WHERE t.organization_id = ${resource.table}.organization_id
          AND t.public_id = $2
          AND t.project_id IS NOT DISTINCT FROM ${resource.table}.project_id
        LIMIT 1
      )`;
        }
        else if (isPubId) {
            filterClause = `public_id = $2`;
        }
        else if (isUuid) {
            filterClause = `${resource.idColumn} = $2`;
        }
        else if (resource.name === 'traces') {
            filterClause = `(trace_id = $2 OR public_id = $2 OR event_id = $2)`;
        }
        else if (resource.name === 'requests') {
            filterClause = `(request_id = $2 OR event_id = $2 OR public_id = $2)`;
        }
        else if (resource.name === 'errors') {
            filterClause = `(event_id = $2 OR public_id = $2 OR fingerprint = $2)`;
        }
        else {
            filterClause = `public_id = $2`;
        }
        let sql = `SELECT ${buildDetailProjection(resource)} FROM ${resource.table}
               WHERE organization_id = $1 AND ${filterClause}`;
        sql += this.projectPredicate(ctx, params);
        sql += ` LIMIT 1`;
        const rows = await this.run(sql, params);
        return rows[0] ?? null;
    }
    /**
     * Fetch multiple raw rows by array of IDs or public_ids for bulk AI analysis.
     */
    async fetchRawByIds(resource, ctx, ids) {
        if (ids.length === 0)
            return [];
        const isPubId = ids.some(id => isPublicId(id));
        const targetColumn = isPubId ? 'public_id' : resource.idColumn;
        const params = [ctx.organizationId, ids.slice(0, 100)];
        let sql = `SELECT ${buildDetailProjection(resource)} FROM ${resource.table}
               WHERE organization_id = $1 AND ${targetColumn}::text = ANY($2::text[])`;
        sql += this.projectPredicate(ctx, params);
        sql += ` LIMIT 100`;
        const rows = await this.run(sql, params);
        return rows.map((row) => projectPublicRow(resource, resource.mapRow(row)));
    }
    /**
     * Fast, bounded count of spans for a request's trace.
     * Prefer trace_id (indexed); fall back to request_id when no trace is attached.
     */
    async countRelatedSpans(ctx, traceId, requestId, from, to) {
        if (!traceId && !requestId)
            return 0;
        const keyColumn = traceId ? 'trace_id' : 'request_id';
        const keyValue = traceId ?? requestId;
        const params = [ctx.organizationId, from, to, keyValue];
        let sql = `SELECT COUNT(*)::int AS count FROM events_spans
               WHERE organization_id = $1
                 AND occurred_at >= $2 AND occurred_at < $3
                 AND ${keyColumn} = $4`;
        sql += this.projectPredicate(ctx, params);
        const rows = await this.run(sql, params);
        return Number(rows[0]?.count ?? 0);
    }
    /**
     * Fast, bounded count of logs correlated to a request by trace_id or request_id.
     * The time window is pinned to the request timestamp so partition pruning stays tight.
     */
    async countRelatedLogs(ctx, traceId, requestId, from, to) {
        if (!traceId && !requestId)
            return 0;
        const keyColumn = traceId ? 'trace_id' : 'request_id';
        const keyValue = traceId ?? requestId;
        const params = [ctx.organizationId, from, to, keyValue];
        let sql = `SELECT COUNT(*)::int AS count FROM events_logs
               WHERE organization_id = $1
                 AND occurred_at >= $2 AND occurred_at < $3
                 AND ${keyColumn} = $4`;
        sql += this.projectPredicate(ctx, params);
        const rows = await this.run(sql, params);
        return Number(rows[0]?.count ?? 0);
    }
    /**
     * Lightweight related errors for a request detail page.
     * Returns only public_id + message; capped at a small limit to keep the response fast.
     */
    async fetchRelatedErrors(ctx, traceId, requestId, from, to, limit = 20) {
        if (!traceId && !requestId)
            return [];
        const keyColumn = traceId ? 'trace_id' : 'request_id';
        const keyValue = traceId ?? requestId;
        const params = [ctx.organizationId, from, to, keyValue];
        let sql = `SELECT public_id, message FROM events_errors
               WHERE organization_id = $1
                 AND occurred_at >= $2 AND occurred_at < $3
                 AND ${keyColumn} = $4`;
        sql += this.projectPredicate(ctx, params);
        params.push(Math.max(1, Math.min(Math.trunc(limit), 100)));
        sql += ` ORDER BY occurred_at DESC LIMIT $${params.length}`;
        const rows = await this.run(sql, params);
        return rows.map((r) => ({ publicId: r.public_id, message: r.message ?? '' }));
    }
    /**
     * Resolve a trace public_id from a trace_id. Used by request detail to build the
     * clickable trace link without loading the full trace payload.
     * Employs strict partition pruning (30-day temporal window with automatic fallback) to
     * prevent sequential partition scans across historical chunks.
     */
    async fetchTracePublicId(ctx, traceId, timeRange) {
        if (!traceId)
            return null;
        const params = [ctx.organizationId, traceId];
        let sql = `SELECT public_id FROM events_traces
               WHERE organization_id = $1 AND trace_id = $2`;
        if (timeRange?.minOccurredAt && timeRange?.maxOccurredAt) {
            params.push(new Date(timeRange.minOccurredAt.getTime() - 24 * 60 * 60 * 1000));
            sql += ` AND occurred_at >= $${params.length}`;
            params.push(new Date(timeRange.maxOccurredAt.getTime() + 60 * 60 * 1000));
            sql += ` AND occurred_at <= $${params.length}`;
        }
        else {
            sql += ` AND occurred_at >= NOW() - INTERVAL '30 days'`;
        }
        sql += this.projectPredicate(ctx, params);
        sql += ` LIMIT 1`;
        const rows = await this.run(sql, params);
        if (rows[0]?.public_id)
            return rows[0].public_id;
        // Fallback: If not found in the 30-day partition window, query without window
        if (!timeRange) {
            const fallbackParams = [ctx.organizationId, traceId];
            let fallbackSql = `SELECT public_id FROM events_traces
                         WHERE organization_id = $1 AND trace_id = $2`;
            fallbackSql += this.projectPredicate(ctx, fallbackParams);
            fallbackSql += ` LIMIT 1`;
            const fallbackRows = await this.run(fallbackSql, fallbackParams);
            return fallbackRows[0]?.public_id ?? null;
        }
        return null;
    }
    /**
     * Resolve a request public_id from a request_id or event_id. Used by error
     * detail to build the clickable request link without loading the full request
     * payload. Matches `request_id` first, then falls back to `event_id` so SDK
     * variants stay compatible.
     */
    async fetchRequestPublicId(ctx, requestId, from, to) {
        if (!requestId)
            return null;
        const params = [ctx.organizationId, requestId, from, to];
        let sql = `SELECT public_id FROM events_requests
               WHERE organization_id = $1
                 AND occurred_at >= $3 AND occurred_at < $4
                 AND (request_id = $2 OR event_id = $2)`;
        sql += this.projectPredicate(ctx, params);
        sql += ` ORDER BY occurred_at DESC LIMIT 1`;
        const rows = await this.run(sql, params);
        return rows[0]?.public_id ?? null;
    }
    /**
     * Resolve an error group public_id from an error_group_id UUID or fingerprint.
     */
    async fetchErrorGroupPublicId(ctx, errorGroupId, fingerprint) {
        if (!errorGroupId && !fingerprint)
            return null;
        const params = [ctx.organizationId];
        let sql = `SELECT public_id FROM error_groups WHERE organization_id = $1 AND `;
        if (errorGroupId && fingerprint) {
            params.push(errorGroupId, fingerprint);
            sql += `(id = $2 OR fingerprint = $3)`;
        }
        else if (errorGroupId) {
            params.push(errorGroupId);
            sql += `id = $2`;
        }
        else {
            params.push(fingerprint);
            sql += `fingerprint = $2`;
        }
        sql += this.projectPredicate(ctx, params);
        sql += ` LIMIT 1`;
        const rows = await this.run(sql, params);
        return rows[0]?.public_id ?? null;
    }
    /** Build a server-owned project predicate for a scoped repository query. */
    projectPredicate(ctx, params, alias) {
        const column = alias ? `${alias}.project_id` : 'project_id';
        if (ctx.projectId) {
            params.push(ctx.projectId);
            return ` AND ${column} = $${params.length}`;
        }
        if (ctx.allowedProjectIds !== undefined) {
            if (ctx.allowedProjectIds.length === 0)
                return ' AND FALSE';
            params.push(ctx.allowedProjectIds);
            return ` AND ${column} = ANY($${params.length})`;
        }
        return '';
    }
    errorGroupPublicIdPredicate(paramRef) {
        return `EXISTS (
      SELECT 1
        FROM error_groups eg
       WHERE eg.organization_id = events_errors.organization_id
         AND (
           eg.id = events_errors.error_group_id
           OR (
             eg.fingerprint = events_errors.fingerprint
             AND eg.project_id IS NOT DISTINCT FROM events_errors.project_id
           )
         )
         AND eg.public_id = ${paramRef}
    )`;
    }
    /**
     * Fetch audit log history for an error group from `error_group_history`.
     */
    async getErrorGroupHistory(ctx, groupId) {
        const params = [groupId, ctx.organizationId];
        let sql = `
      SELECT h.id, h.group_id, h.action, h.old_value, h.new_value, h.actor_id, h.metadata, h.created_at,
             e.last_error_name
        FROM error_group_history h
        JOIN error_groups e ON e.id = h.group_id
       WHERE (e.id::text = $1 OR e.public_id = $1)
         AND e.organization_id = $2`;
        sql += this.projectPredicate(ctx, params, 'e');
        sql += ` ORDER BY h.created_at DESC LIMIT 100`;
        const rows = await logDB.queryWithRetry(sql, params, { operation: 'read' });
        return rows.rows.map((r) => ({
            id: r.id,
            groupId: r.group_id,
            actor: r.actor_id ? String(r.actor_id) : 'System',
            timestamp: r.created_at,
            action: r.action,
            oldValue: this.parseJsonValue(r.old_value),
            newValue: this.parseJsonValue(r.new_value),
            metadata: this.parseJsonValue(r.metadata),
        }));
    }
    parseJsonValue(value) {
        if (typeof value !== 'string')
            return value ?? undefined;
        try {
            return JSON.parse(value);
        }
        catch {
            return value;
        }
    }
    errorGroupMatchPredicate(params, groupId, fingerprint) {
        const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
        if (groupId && fingerprint) {
            params.push(groupId, fingerprint);
            const gidParam = `$${params.length - 1}`;
            const fpParam = `$${params.length}`;
            if (isUuid(groupId)) {
                return ` AND (error_group_id = ${gidParam}::uuid OR error_group_id IN (SELECT id FROM error_groups WHERE organization_id = $1 AND merged_into = ${gidParam}::uuid) OR ${this.errorGroupPublicIdPredicate(gidParam)} OR fingerprint = ${fpParam})`;
            }
            return ` AND (error_group_id::text = ${gidParam} OR error_group_id IN (SELECT id FROM error_groups WHERE organization_id = $1 AND merged_into::text = ${gidParam}) OR ${this.errorGroupPublicIdPredicate(gidParam)} OR fingerprint = ${fpParam})`;
        }
        if (groupId) {
            params.push(groupId);
            const gidParam = `$${params.length}`;
            if (isUuid(groupId)) {
                return ` AND (error_group_id = ${gidParam}::uuid OR error_group_id IN (SELECT id FROM error_groups WHERE organization_id = $1 AND merged_into = ${gidParam}::uuid) OR ${this.errorGroupPublicIdPredicate(gidParam)})`;
            }
            return ` AND (error_group_id::text = ${gidParam} OR error_group_id IN (SELECT id FROM error_groups WHERE organization_id = $1 AND merged_into::text = ${gidParam}) OR ${this.errorGroupPublicIdPredicate(gidParam)})`;
        }
        if (fingerprint) {
            params.push(fingerprint);
            return ` AND fingerprint = $${params.length}`;
        }
        return '';
    }
    /**
     * Fetch related error telemetry events from `events_errors` for an error group.
     */
    async getRelatedErrorEvents(ctx, groupId, fingerprint, limit = 50) {
        const params = [ctx.organizationId];
        let sql = `
      SELECT id, public_id, occurred_at, message, severity, handled, route, status_code, trace_id
      FROM events_errors
      WHERE organization_id = $1
    `;
        sql += this.errorGroupMatchPredicate(params, groupId, fingerprint);
        sql += this.projectPredicate(ctx, params);
        params.push(Math.max(1, Math.min(Math.trunc(limit), 100)));
        sql += ` ORDER BY occurred_at DESC LIMIT $${params.length}`;
        const result = await logDB.queryWithRetry(sql, params, { operation: 'read' });
        const errorRows = result.rows;
        if (errorRows.length === 0)
            return [];
        const traceIds = Array.from(new Set(errorRows
            .map((r) => r.trace_id)
            .filter((t) => typeof t === 'string' && t.length > 0)));
        let minOccurredAt;
        let maxOccurredAt;
        for (const r of errorRows) {
            if (r.occurred_at instanceof Date) {
                if (!minOccurredAt || r.occurred_at < minOccurredAt)
                    minOccurredAt = r.occurred_at;
                if (!maxOccurredAt || r.occurred_at > maxOccurredAt)
                    maxOccurredAt = r.occurred_at;
            }
            else if (typeof r.occurred_at === 'string') {
                const d = new Date(r.occurred_at);
                if (!isNaN(d.getTime())) {
                    if (!minOccurredAt || d < minOccurredAt)
                        minOccurredAt = d;
                    if (!maxOccurredAt || d > maxOccurredAt)
                        maxOccurredAt = d;
                }
            }
        }
        const tracePublicIdMap = await this.fetchTracePublicIdMap(ctx, traceIds, minOccurredAt && maxOccurredAt ? { minOccurredAt, maxOccurredAt } : undefined);
        return errorRows.map((r) => ({
            id: r.id,
            publicId: r.public_id ?? null,
            occurredAt: r.occurred_at,
            message: r.message ?? '',
            severity: r.severity?.toLowerCase() ?? 'error',
            handled: Boolean(r.handled),
            route: r.route ?? '',
            statusCode: r.status_code ?? 500,
            traceId: r.trace_id ?? '',
            tracePublicId: r.trace_id ? (tracePublicIdMap.get(r.trace_id) ?? null) : null,
        }));
    }
    /**
     * Fetch latest stack frames and event metadata for an error group sample.
     */
    async getErrorGroupStackFrames(ctx, groupId, fingerprint) {
        const params = [ctx.organizationId];
        let sql = `
      SELECT stack_frames, route, trace_id, status_code
      FROM events_errors
      WHERE organization_id = $1 AND stack_frames IS NOT NULL
    `;
        sql += this.errorGroupMatchPredicate(params, groupId, fingerprint);
        sql += this.projectPredicate(ctx, params);
        sql += ` ORDER BY occurred_at DESC LIMIT 1`;
        const result = await logDB.queryWithRetry(sql, params, { operation: 'read' });
        const row = result.rows[0];
        if (!row)
            return null;
        let frames = [];
        if (Array.isArray(row.stack_frames)) {
            frames = row.stack_frames;
        }
        else if (typeof row.stack_frames === 'string') {
            try {
                frames = JSON.parse(row.stack_frames);
            }
            catch {
                frames = [];
            }
        }
        return {
            stackFrames: frames,
            route: row.route ? String(row.route) : undefined,
            traceId: row.trace_id ? String(row.trace_id) : undefined,
            statusCode: row.status_code ? Number(row.status_code) : undefined,
        };
    }
    /**
     * Calculate occurrence trends (24h hourly, 7d daily, 30d daily) for an error group.
     */
    async getErrorGroupTrends(ctx, groupId, fingerprint) {
        const params = [ctx.organizationId];
        let whereClause = `WHERE organization_id = $1`;
        whereClause += this.errorGroupMatchPredicate(params, groupId, fingerprint);
        whereClause += this.projectPredicate(ctx, params);
        // 24h Hourly buckets
        const sql24h = `
      SELECT date_trunc('hour', occurred_at) AS bucket, COUNT(*)::int AS count
      FROM events_errors
      ${whereClause} AND occurred_at >= NOW() - INTERVAL '24 hours'
      GROUP BY bucket ORDER BY bucket ASC
    `;
        // 30d Daily buckets (7d trend is derived from the last 7 buckets of this query, eliminating a redundant full scan)
        const sql30d = `
      SELECT date_trunc('day', occurred_at) AS bucket, COUNT(*)::int AS count
      FROM events_errors
      ${whereClause} AND occurred_at >= NOW() - INTERVAL '30 days'
      GROUP BY bucket ORDER BY bucket ASC
    `;
        const [res24h, res30d] = await Promise.all([
            logDB.queryWithRetry(sql24h, params, { operation: 'read' }).catch(() => ({ rows: [] })),
            logDB.queryWithRetry(sql30d, params, { operation: 'read' }).catch(() => ({ rows: [] })),
        ]);
        const trend24h = (res24h.rows.length > 0 ? res24h.rows.map((r) => r.count) : Array(24).fill(0));
        const trend30d = (res30d.rows.length > 0 ? res30d.rows.map((r) => r.count) : Array(7).fill(0));
        const trend7d = (trend30d.length >= 7 ? trend30d.slice(-7) : trend30d);
        return { trend24h, trend7d, trend30d };
    }
    /**
     * Fetch the latest raw error detail row for an Error Group public ID, ID, or fingerprint.
     */
    async fetchLatestErrorForGroup(ctx, groupIdentifier) {
        const params = [ctx.organizationId, groupIdentifier];
        let sql = `SELECT ${buildDetailProjection(errorsResource)} FROM events_errors
               WHERE organization_id = $1
                 AND (${this.errorGroupPublicIdPredicate('$2')} OR error_group_id::text = $2 OR fingerprint = $2)`;
        sql += this.projectPredicate(ctx, params);
        sql += ` ORDER BY occurred_at DESC LIMIT 1`;
        const rows = await this.run(sql, params);
        return rows[0] ?? null;
    }
    /**
     * Update error group status and log audit history.
     */
    async updateErrorGroupStatus(ctx, groupId, status, actorId, comment) {
        return logDB.withTransaction(async (client) => {
            const params = [groupId, ctx.organizationId];
            let scope = '';
            if (ctx.projectId) {
                params.push(ctx.projectId);
                scope = ` AND project_id = $${params.length}`;
            }
            else if (ctx.allowedProjectIds !== undefined) {
                if (ctx.allowedProjectIds.length === 0)
                    return null;
                params.push(ctx.allowedProjectIds);
                scope = ` AND project_id = ANY($${params.length})`;
            }
            const fetchRes = await client.query(`SELECT id, organization_id, project_id, status, occurrence_count, version
           FROM error_groups
          WHERE id = $1 AND organization_id = $2${scope}
          LIMIT 1 FOR UPDATE`, params);
            const existing = fetchRes.rows[0];
            if (!existing)
                return null;
            const oldStatus = String(existing.status ?? '').toLowerCase();
            const normalizedStatus = status.toLowerCase();
            const updateRes = await client.query(`UPDATE error_groups
            SET status = $1, version = version + 1, updated_at = NOW()
          WHERE id = $2 AND organization_id = $3
          RETURNING id, organization_id, project_id, fingerprint, status, occurrence_count, version, updated_at`, [normalizedStatus, groupId, ctx.organizationId]);
            const action = normalizedStatus === 'resolved'
                ? 'marked_resolved'
                : normalizedStatus === 'ignored'
                    ? 'ignored'
                    : normalizedStatus === 'archived'
                        ? 'archived'
                        : 'reopened';
            await client.query(`INSERT INTO error_group_history (group_id, action, old_value, new_value, actor_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`, [
                groupId,
                action,
                JSON.stringify({ status: oldStatus }),
                JSON.stringify({ status: normalizedStatus }),
                actorId,
                JSON.stringify(comment ? { comment } : {}),
            ]);
            return updateRes.rows[0] ?? null;
        });
    }
    /**
     * Merge source error group into target error group.
     */
    async mergeErrorGroups(ctx, sourceGroupId, targetGroupId, actorId) {
        if (sourceGroupId === targetGroupId)
            return null;
        return logDB.withTransaction(async (client) => {
            const ids = [sourceGroupId, targetGroupId].sort();
            const params = [ctx.organizationId, ids];
            let scope = '';
            if (ctx.projectId) {
                params.push(ctx.projectId);
                scope = ` AND project_id = $${params.length}`;
            }
            else if (ctx.allowedProjectIds !== undefined) {
                if (ctx.allowedProjectIds.length === 0)
                    return null;
                params.push(ctx.allowedProjectIds);
                scope = ` AND project_id = ANY($${params.length})`;
            }
            const locked = await client.query(`SELECT id, organization_id, project_id, status, occurrence_count, fingerprint
           FROM error_groups
          WHERE organization_id = $1 AND id = ANY($2::uuid[])${scope}
          ORDER BY id
          FOR UPDATE`, params);
            if (locked.rows.length !== 2)
                return null;
            const source = locked.rows.find((row) => row.id === sourceGroupId);
            const target = locked.rows.find((row) => row.id === targetGroupId);
            if (!source || !target)
                return null;
            const sourceOccurrences = Number(source.occurrence_count ?? 1);
            await client.query(`UPDATE error_groups
            SET is_merged = true, merged_into = $1, status = 'archived', version = version + 1, updated_at = NOW()
          WHERE id = $2 AND organization_id = $3`, [targetGroupId, sourceGroupId, ctx.organizationId]);
            const updatedTargetRes = await client.query(`UPDATE error_groups
            SET occurrence_count = occurrence_count + $1, version = version + 1, updated_at = NOW()
          WHERE id = $2 AND organization_id = $3
          RETURNING id, organization_id, project_id, fingerprint, status, occurrence_count, version, updated_at`, [sourceOccurrences, targetGroupId, ctx.organizationId]);
            await client.query(`INSERT INTO error_group_history (group_id, action, old_value, new_value, actor_id, metadata)
         VALUES ($1, 'merged', $2, $3, $4, $5),
                ($6, 'merged', $7, $8, $4, $9)`, [
                sourceGroupId,
                JSON.stringify({ status: source.status }),
                JSON.stringify({ mergedInto: targetGroupId, status: 'archived' }),
                actorId,
                JSON.stringify({ targetGroupId }),
                targetGroupId,
                JSON.stringify({ occurrenceCount: target.occurrence_count }),
                JSON.stringify({ occurrenceCount: Number(target.occurrence_count) + sourceOccurrences }),
                JSON.stringify({ mergedFromId: sourceGroupId }),
            ]);
            return updatedTargetRes.rows[0] ?? null;
        });
    }
    /**
     * Batch resolve trace public_ids for an array of trace_ids.
     */
    async fetchTracePublicIdMap(ctx, traceIds, timeRange) {
        const map = new Map();
        const cleanTraceIds = Array.from(new Set(traceIds.filter((t) => typeof t === 'string' && t.length > 0)));
        if (cleanTraceIds.length === 0)
            return map;
        const params = [ctx.organizationId, cleanTraceIds.slice(0, 200)];
        let sql = `SELECT trace_id, public_id FROM events_traces
               WHERE organization_id = $1 AND trace_id = ANY($2::text[])`;
        if (timeRange?.minOccurredAt && timeRange?.maxOccurredAt) {
            params.push(new Date(timeRange.minOccurredAt.getTime() - 24 * 60 * 60 * 1000));
            sql += ` AND occurred_at >= $${params.length}`;
            params.push(new Date(timeRange.maxOccurredAt.getTime() + 60 * 60 * 1000));
            sql += ` AND occurred_at <= $${params.length}`;
        }
        else {
            // Default to 30-day window to activate strict PostgreSQL partition pruning
            sql += ` AND occurred_at >= NOW() - INTERVAL '30 days'`;
        }
        sql += this.projectPredicate(ctx, params);
        const rows = await this.run(sql, params);
        for (const r of rows) {
            if (r.trace_id && r.public_id)
                map.set(r.trace_id, r.public_id);
        }
        // Fallback: If any traces were not found within the temporal window, query without the window for just those missing traceIds
        const missing = cleanTraceIds.filter((t) => !map.has(t));
        if (missing.length > 0) {
            const fallbackParams = [ctx.organizationId, missing.slice(0, 200)];
            let fallbackSql = `SELECT trace_id, public_id FROM events_traces
                         WHERE organization_id = $1 AND trace_id = ANY($2::text[])`;
            fallbackSql += this.projectPredicate(ctx, fallbackParams);
            const fallbackRows = await this.run(fallbackSql, fallbackParams);
            for (const r of fallbackRows) {
                if (r.trace_id && r.public_id)
                    map.set(r.trace_id, r.public_id);
            }
        }
        return map;
    }
    /**
     * Batch resolve latest event public_ids for an array of error group IDs or public IDs.
     * Resolves group UUIDs first via error_groups table, then queries events_errors directly
     * using indexed error_group_id without Cartesian joins or disk-spill sorting (OBS-Q005).
     */
    async fetchLatestEventPublicIdMap(ctx, groupIds) {
        const map = new Map();
        const cleanIds = Array.from(new Set(groupIds.filter((g) => typeof g === 'string' && g.length > 0)));
        if (cleanIds.length === 0)
            return map;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const groupToPublicId = new Map();
        const resolvedGroupUuids = new Set();
        for (const id of cleanIds) {
            if (uuidRegex.test(id)) {
                resolvedGroupUuids.add(id);
            }
        }
        // Step 1: Resolve error_groups mapping for requested IDs (both UUIDs and public_ids)
        const egParams = [ctx.organizationId, cleanIds.slice(0, 200)];
        let egSql = `SELECT id, public_id
                 FROM error_groups
                 WHERE organization_id = $1
                   AND (id::text = ANY($2::text[]) OR public_id = ANY($2::text[]))`;
        egSql += this.projectPredicate(ctx, egParams);
        const egRows = await this.run(egSql, egParams);
        for (const r of egRows) {
            if (r.id) {
                resolvedGroupUuids.add(r.id);
                if (r.public_id) {
                    groupToPublicId.set(r.id, r.public_id);
                    groupToPublicId.set(r.public_id, r.id);
                }
            }
        }
        if (resolvedGroupUuids.size === 0)
            return map;
        // Step 2: Query events_errors directly with indexed error_group_id without any join
        const targetUuids = Array.from(resolvedGroupUuids).slice(0, 200);
        const params = [ctx.organizationId, targetUuids];
        let sql = `SELECT DISTINCT ON (error_group_id) error_group_id, public_id
               FROM events_errors
               WHERE organization_id = $1
                 AND error_group_id = ANY($2::uuid[])`;
        sql += this.projectPredicate(ctx, params);
        sql += ` ORDER BY error_group_id, occurred_at DESC`;
        const rows = await this.run(sql, params);
        for (const r of rows) {
            if (r.public_id && r.error_group_id) {
                map.set(r.error_group_id, r.public_id);
                const pubId = groupToPublicId.get(r.error_group_id);
                if (pubId) {
                    map.set(pubId, r.public_id);
                }
            }
        }
        return map;
    }
    /**
     * Resolve a project ID (UUID) from a project slug.
     */
    async resolveProjectIdFromSlug(ctx, slug) {
        if (!slug || slug.trim().length === 0)
            return null;
        const cleanSlug = slug.trim();
        // If it's already a UUID, return as-is
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanSlug)) {
            return cleanSlug;
        }
        // 1. Try LogDB project_lookup (fastest path on read database)
        try {
            const res = await logDB.queryWithRetry('SELECT project_id FROM project_lookup WHERE organization_id = $1 AND slug = $2 LIMIT 1', [ctx.organizationId, cleanSlug], { operation: 'read' });
            if (res.rows[0]?.project_id) {
                return res.rows[0].project_id;
            }
        }
        catch {
            // Fallback below
        }
        // 2. Fallback to Primary DB projects table (canonical authority)
        try {
            const res = await pool.query('SELECT id FROM projects WHERE org_id = $1 AND slug = $2 AND deleted_at IS NULL LIMIT 1', [ctx.organizationId, cleanSlug]);
            return res.rows[0]?.id ?? null;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=repository.js.map