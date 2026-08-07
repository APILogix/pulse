import { logDB } from '../../config/log-database.js';
import { buildDetailProjection, buildPublicProjection, projectPublicRow, } from './query-engine/index.js';
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
     * Fetch a single row by id, returning the raw row (all columns) so detail
     * assembly can read correlation keys the projection would omit.
     */
    async fetchRawById(resource, ctx, id) {
        const params = [ctx.organizationId, id];
        let sql = `SELECT ${buildDetailProjection(resource)} FROM ${resource.table}
               WHERE organization_id = $1 AND ${resource.idColumn} = $2`;
        sql += this.projectPredicate(ctx, params);
        sql += ` LIMIT 1`;
        const rows = await this.run(sql, params);
        return rows[0] ?? null;
    }
    /**
     * Fetch multiple raw rows by array of IDs for bulk AI analysis.
     */
    async fetchRawByIds(resource, ctx, ids) {
        if (ids.length === 0)
            return [];
        const params = [ctx.organizationId, ids.slice(0, 100)];
        let sql = `SELECT ${buildDetailProjection(resource)} FROM ${resource.table}
               WHERE organization_id = $1 AND ${resource.idColumn}::text = ANY($2::text[])`;
        sql += this.projectPredicate(ctx, params);
        sql += ` LIMIT 100`;
        const rows = await this.run(sql, params);
        return rows.map((row) => projectPublicRow(resource, resource.mapRow(row)));
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
       WHERE h.group_id = $1
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
    /**
     * Fetch related error telemetry events from `events_errors` for an error group.
     */
    async getRelatedErrorEvents(ctx, groupId, fingerprint, limit = 50) {
        const params = [ctx.organizationId];
        let sql = `
      SELECT id, occurred_at, message, severity, handled, route, status_code, trace_id
      FROM events_errors
      WHERE organization_id = $1
    `;
        if (groupId && fingerprint) {
            params.push(groupId, fingerprint);
            sql += ` AND (error_group_id = $2 OR fingerprint = $3)`;
        }
        else if (groupId) {
            params.push(groupId);
            sql += ` AND error_group_id = $2`;
        }
        else if (fingerprint) {
            params.push(fingerprint);
            sql += ` AND fingerprint = $2`;
        }
        sql += this.projectPredicate(ctx, params);
        params.push(Math.max(1, Math.min(Math.trunc(limit), 100)));
        sql += ` ORDER BY occurred_at DESC LIMIT $${params.length}`;
        const result = await logDB.queryWithRetry(sql, params, { operation: 'read' });
        return result.rows.map((r) => ({
            id: r.id,
            occurredAt: r.occurred_at,
            message: r.message ?? '',
            severity: r.severity?.toLowerCase() ?? 'error',
            handled: Boolean(r.handled),
            route: r.route ?? '',
            statusCode: r.status_code ?? 500,
            traceId: r.trace_id ?? '',
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
        if (groupId && fingerprint) {
            params.push(groupId, fingerprint);
            sql += ` AND (error_group_id = $2 OR fingerprint = $3)`;
        }
        else if (groupId) {
            params.push(groupId);
            sql += ` AND error_group_id = $2`;
        }
        else if (fingerprint) {
            params.push(fingerprint);
            sql += ` AND fingerprint = $2`;
        }
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
        if (groupId && fingerprint) {
            params.push(groupId, fingerprint);
            whereClause += ` AND (error_group_id = $2 OR fingerprint = $3)`;
        }
        else if (groupId) {
            params.push(groupId);
            whereClause += ` AND error_group_id = $2`;
        }
        else if (fingerprint) {
            params.push(fingerprint);
            whereClause += ` AND fingerprint = $2`;
        }
        whereClause += this.projectPredicate(ctx, params);
        // 24h Hourly buckets
        const sql24h = `
      SELECT date_trunc('hour', occurred_at) AS bucket, COUNT(*)::int AS count
      FROM events_errors
      ${whereClause} AND occurred_at >= NOW() - INTERVAL '24 hours'
      GROUP BY bucket ORDER BY bucket ASC
    `;
        // 7d Daily buckets
        const sql7d = `
      SELECT date_trunc('day', occurred_at) AS bucket, COUNT(*)::int AS count
      FROM events_errors
      ${whereClause} AND occurred_at >= NOW() - INTERVAL '7 days'
      GROUP BY bucket ORDER BY bucket ASC
    `;
        // 30d Daily buckets
        const sql30d = `
      SELECT date_trunc('day', occurred_at) AS bucket, COUNT(*)::int AS count
      FROM events_errors
      ${whereClause} AND occurred_at >= NOW() - INTERVAL '30 days'
      GROUP BY bucket ORDER BY bucket ASC
    `;
        const [res24h, res7d, res30d] = await Promise.all([
            logDB.queryWithRetry(sql24h, params, { operation: 'read' }).catch(() => ({ rows: [] })),
            logDB.queryWithRetry(sql7d, params, { operation: 'read' }).catch(() => ({ rows: [] })),
            logDB.queryWithRetry(sql30d, params, { operation: 'read' }).catch(() => ({ rows: [] })),
        ]);
        const trend24h = (res24h.rows.length > 0 ? res24h.rows.map((r) => r.count) : Array(24).fill(0));
        const trend7d = (res7d.rows.length > 0 ? res7d.rows.map((r) => r.count) : Array(7).fill(0));
        const trend30d = (res30d.rows.length > 0 ? res30d.rows.map((r) => r.count) : Array(7).fill(0));
        return { trend24h, trend7d, trend30d };
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
            const eventParams = [targetGroupId, sourceGroupId, ctx.organizationId];
            let eventScope = '';
            if (ctx.projectId) {
                eventParams.push(ctx.projectId);
                eventScope = ` AND project_id = $${eventParams.length}`;
            }
            else if (ctx.allowedProjectIds !== undefined) {
                eventParams.push(ctx.allowedProjectIds);
                eventScope = ` AND project_id = ANY($${eventParams.length})`;
            }
            await client.query(`UPDATE events_errors
            SET error_group_id = $1
          WHERE error_group_id = $2 AND organization_id = $3${eventScope}`, eventParams);
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
}
//# sourceMappingURL=repository.js.map