/**
 * Observability repository — the data-access layer.
 *
 * Implements {@link QueryExecutor} so the engine can run its generated SQL, and
 * exposes safe, allow-listed correlation fetchers used by the correlation
 * engine + detail assembler. All reads go through `logDB.queryWithRetry` on the
 * read path (replica when configured) with retry/backoff.
 */
import type { QueryResultRow } from 'pg';
import { logDB } from '../../config/log-database.js';
import type { ExplorerResource, QueryContext, QueryExecutor } from './query-engine/index.js';

/** Columns that may be used as a correlation key. Fixed allow-list. */
export const CORRELATION_COLUMNS = [
  'trace_id',
  'request_id',
  'span_id',
  'parent_span_id',
  'session_id',
  'user_id',
] as const;
export type CorrelationColumn = (typeof CORRELATION_COLUMNS)[number];

export interface CorrelationFetch {
  resource: ExplorerResource;
  ctx: QueryContext;
  column: CorrelationColumn;
  value: string;
  from: Date;
  to: Date;
  limit: number;
  /** Optional row id to exclude (usually the seed event itself). */
  excludeId?: string;
}

export class ObservabilityRepository implements QueryExecutor {
  /** Execute engine-generated SQL on the read path. */
  async run<T extends QueryResultRow>(sql: string, params: unknown[]): Promise<T[]> {
    const result = await logDB.queryWithRetry<T>(sql, params, { operation: 'read' });
    return result.rows;
  }

  /**
   * Fetch rows of a resource correlated by a fixed key column within the
   * tenant + time window. The column is validated against
   * {@link CORRELATION_COLUMNS}; every value is bound as a parameter.
   */
  async fetchCorrelated(input: CorrelationFetch): Promise<Array<Record<string, unknown>>> {
    if (!CORRELATION_COLUMNS.includes(input.column)) {
      throw new Error(`Illegal correlation column: ${input.column}`);
    }
    const { resource, ctx } = input;
    const params: unknown[] = [ctx.organizationId, input.value, input.from, input.to];
    let sql = `SELECT * FROM ${resource.table}
               WHERE organization_id = $1 AND ${input.column} = $2
               AND ${resource.timeColumn} >= $3 AND ${resource.timeColumn} < $4`;
    const projectId = ctx.projectId;
    if (projectId) {
      params.push(projectId);
      sql += ` AND project_id = $${params.length}`;
    }
    if (input.excludeId) {
      params.push(input.excludeId);
      sql += ` AND ${resource.idColumn} <> $${params.length}`;
    }
    params.push(input.limit);
    sql += ` ORDER BY ${resource.timeColumn} ASC LIMIT $${params.length}`;

    const rows = await this.run<Record<string, unknown>>(sql, params);
    return rows.map((row) => resource.mapRow(row) as Record<string, unknown>);
  }

  /**
   * Fetch a single row by id, returning the raw row (all columns) so detail
   * assembly can read correlation keys the projection would omit.
   */
  async fetchRawById(
    resource: ExplorerResource,
    ctx: QueryContext,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const params: unknown[] = [ctx.organizationId, id];
    let sql = `SELECT * FROM ${resource.table} WHERE organization_id = $1 AND ${resource.idColumn} = $2`;
    if (ctx.projectId) {
      params.push(ctx.projectId);
      sql += ` AND project_id = $${params.length}`;
    }
    sql += ` LIMIT 1`;
    const rows = await this.run<Record<string, unknown>>(sql, params);
    return rows[0] ?? null;
  }

  /**
   * Fetch multiple raw rows by array of IDs for bulk AI analysis.
   */
  async fetchRawByIds(
    resource: ExplorerResource,
    ctx: QueryContext,
    ids: string[],
  ): Promise<Array<Record<string, unknown>>> {
    if (ids.length === 0) return [];
    const params: unknown[] = [ctx.organizationId, ids];
    let sql = `SELECT * FROM ${resource.table} WHERE organization_id = $1 AND ${resource.idColumn}::text = ANY($2::text[])`;
    if (ctx.projectId) {
      params.push(ctx.projectId);
      sql += ` AND project_id = $${params.length}`;
    }
    sql += ` LIMIT 100`;
    const rows = await this.run<Record<string, unknown>>(sql, params);
    return rows.map((row) => resource.mapRow(row) as Record<string, unknown>);
  }

  /**
   * Fetch audit log history for an error group from `error_group_history`.
   */
  async getErrorGroupHistory(ctx: QueryContext, groupId: string): Promise<Array<Record<string, unknown>>> {
    const sql = `
      SELECT h.*, e.last_error_name
      FROM error_group_history h
      LEFT JOIN error_groups e ON e.id = h.group_id
      WHERE h.group_id = $1
      ORDER BY h.created_at DESC
      LIMIT 100
    `;
    const rows = await logDB.queryWithRetry<Record<string, unknown>>(sql, [groupId], { operation: 'read' });
    return rows.rows.map((r) => {
      let oldValue = r.old_value;
      if (typeof oldValue === 'string') {
        try { oldValue = JSON.parse(oldValue); } catch {}
      }
      let newValue = r.new_value;
      if (typeof newValue === 'string') {
        try { newValue = JSON.parse(newValue); } catch {}
      }
      let metadata = r.metadata;
      if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch {}
      }
      return {
        id: r.id,
        groupId: r.group_id,
        group_id: r.group_id,
        actor: r.actor_id ? String(r.actor_id) : 'System',
        actor_id: r.actor_id,
        timestamp: r.created_at,
        created_at: r.created_at,
        action: r.action,
        oldValue: oldValue ?? undefined,
        old_value: r.old_value ?? undefined,
        newValue: newValue ?? undefined,
        new_value: r.new_value ?? undefined,
        metadata: metadata ?? undefined,
      };
    });
  }

  /**
   * Fetch related error telemetry events from `events_errors` for an error group.
   */
  async getRelatedErrorEvents(
    ctx: QueryContext,
    groupId: string,
    fingerprint?: string,
    limit = 50,
  ): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = [ctx.organizationId];
    let sql = `
      SELECT id, occurred_at, message, severity, handled, route, status_code, trace_id
      FROM events_errors
      WHERE organization_id = $1
    `;

    if (groupId && fingerprint) {
      params.push(groupId, fingerprint);
      sql += ` AND (error_group_id = $2 OR fingerprint = $3)`;
    } else if (groupId) {
      params.push(groupId);
      sql += ` AND error_group_id = $2`;
    } else if (fingerprint) {
      params.push(fingerprint);
      sql += ` AND fingerprint = $2`;
    }

    if (ctx.projectId) {
      params.push(ctx.projectId);
      sql += ` AND project_id = $${params.length}`;
    }

    params.push(limit);
    sql += ` ORDER BY occurred_at DESC LIMIT $${params.length}`;

    const result = await logDB.queryWithRetry<Record<string, unknown>>(sql, params, { operation: 'read' });
    return result.rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at,
      message: r.message ?? '',
      severity: (r.severity as string)?.toLowerCase() ?? 'error',
      handled: Boolean(r.handled),
      route: r.route ?? '',
      statusCode: r.status_code ?? 500,
      traceId: r.trace_id ?? '',
    }));
  }

  /**
   * Fetch latest stack frames and event metadata for an error group sample.
   */
  async getErrorGroupStackFrames(
    ctx: QueryContext,
    groupId: string,
    fingerprint?: string,
  ): Promise<{ stackFrames: unknown[]; route?: string | undefined; traceId?: string | undefined; statusCode?: number | undefined } | null> {
    const params: unknown[] = [ctx.organizationId];
    let sql = `
      SELECT stack_frames, route, trace_id, status_code
      FROM events_errors
      WHERE organization_id = $1 AND stack_frames IS NOT NULL
    `;

    if (groupId && fingerprint) {
      params.push(groupId, fingerprint);
      sql += ` AND (error_group_id = $2 OR fingerprint = $3)`;
    } else if (groupId) {
      params.push(groupId);
      sql += ` AND error_group_id = $2`;
    } else if (fingerprint) {
      params.push(fingerprint);
      sql += ` AND fingerprint = $2`;
    }

    sql += ` ORDER BY occurred_at DESC LIMIT 1`;

    const result = await logDB.queryWithRetry<Record<string, unknown>>(sql, params, { operation: 'read' });
    const row = result.rows[0];
    if (!row) return null;

    let frames: unknown[] = [];
    if (Array.isArray(row.stack_frames)) {
      frames = row.stack_frames;
    } else if (typeof row.stack_frames === 'string') {
      try { frames = JSON.parse(row.stack_frames); } catch { frames = []; }
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
  async getErrorGroupTrends(
    ctx: QueryContext,
    groupId: string,
    fingerprint?: string,
  ): Promise<{ trend24h: number[]; trend7d: number[]; trend30d: number[] }> {
    const params: unknown[] = [ctx.organizationId];
    let whereClause = `WHERE organization_id = $1`;
    if (groupId && fingerprint) {
      params.push(groupId, fingerprint);
      whereClause += ` AND (error_group_id = $2 OR fingerprint = $3)`;
    } else if (groupId) {
      params.push(groupId);
      whereClause += ` AND error_group_id = $2`;
    } else if (fingerprint) {
      params.push(fingerprint);
      whereClause += ` AND fingerprint = $2`;
    }

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
      logDB.queryWithRetry<{ bucket: Date; count: number }>(sql24h, params, { operation: 'read' }).catch(() => ({ rows: [] })),
      logDB.queryWithRetry<{ bucket: Date; count: number }>(sql7d, params, { operation: 'read' }).catch(() => ({ rows: [] })),
      logDB.queryWithRetry<{ bucket: Date; count: number }>(sql30d, params, { operation: 'read' }).catch(() => ({ rows: [] })),
    ]);

    const trend24h = (res24h.rows.length > 0 ? res24h.rows.map((r) => r.count) : Array(24).fill(0));
    const trend7d = (res7d.rows.length > 0 ? res7d.rows.map((r) => r.count) : Array(7).fill(0));
    const trend30d = (res30d.rows.length > 0 ? res30d.rows.map((r) => r.count) : Array(7).fill(0));

    return { trend24h, trend7d, trend30d };
  }

  /**
   * Update error group status and log audit history.
   */
  async updateErrorGroupStatus(
    ctx: QueryContext,
    groupId: string,
    status: string,
    actorId: string,
    comment?: string,
  ): Promise<Record<string, unknown> | null> {
    return logDB.withTransaction(async (client) => {
      const fetchRes = await client.query<Record<string, unknown>>(
        `SELECT * FROM error_groups WHERE id = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
        [groupId, ctx.organizationId],
      );
      const existing = fetchRes.rows[0];
      if (!existing) return null;

      const oldStatus = existing.status;
      const normalizedStatus = status.toLowerCase();

      const updateRes = await client.query<Record<string, unknown>>(
        `UPDATE error_groups SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [normalizedStatus, groupId],
      );

      const action =
        normalizedStatus === 'resolved'
          ? 'marked_resolved'
          : normalizedStatus === 'ignored'
          ? 'ignored'
          : normalizedStatus === 'archived'
          ? 'archived'
          : 'reopened';

      await client.query(
        `INSERT INTO error_group_history (group_id, action, old_value, new_value, actor_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          groupId,
          action,
          JSON.stringify({ status: oldStatus }),
          JSON.stringify({ status: normalizedStatus }),
          actorId,
          JSON.stringify(comment ? { comment } : {}),
        ],
      );

      return updateRes.rows[0] ?? null;
    });
  }

  /**
   * Merge source error group into target error group.
   */
  async mergeErrorGroups(
    ctx: QueryContext,
    sourceGroupId: string,
    targetGroupId: string,
    actorId: string,
  ): Promise<Record<string, unknown> | null> {
    return logDB.withTransaction(async (client) => {
      const sourceRes = await client.query<Record<string, unknown>>(
        `SELECT * FROM error_groups WHERE id = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
        [sourceGroupId, ctx.organizationId],
      );
      const targetRes = await client.query<Record<string, unknown>>(
        `SELECT * FROM error_groups WHERE id = $1 AND organization_id = $2 LIMIT 1 FOR UPDATE`,
        [targetGroupId, ctx.organizationId],
      );

      const source = sourceRes.rows[0];
      const target = targetRes.rows[0];
      if (!source || !target) return null;

      const sourceOccurrences = Number(source.occurrence_count ?? 1);

      // 1. Mark source group as merged & archived
      await client.query(
        `UPDATE error_groups
         SET is_merged = true, merged_into = $1, status = 'archived', updated_at = NOW()
         WHERE id = $2`,
        [targetGroupId, sourceGroupId],
      );

      // 2. Increment target group occurrence count
      const updatedTargetRes = await client.query<Record<string, unknown>>(
        `UPDATE error_groups
         SET occurrence_count = occurrence_count + $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [sourceOccurrences, targetGroupId],
      );

      // 3. Reassign related events in events_errors
      await client.query(
        `UPDATE events_errors SET error_group_id = $1 WHERE error_group_id = $2`,
        [targetGroupId, sourceGroupId],
      );

      // 4. Record audit history for both
      await client.query(
        `INSERT INTO error_group_history (group_id, action, old_value, new_value, actor_id, metadata)
         VALUES ($1, 'merged', $2, $3, $4, $5)`,
        [
          sourceGroupId,
          JSON.stringify({ status: source.status }),
          JSON.stringify({ mergedInto: targetGroupId, status: 'archived' }),
          actorId,
          JSON.stringify({ targetGroupId }),
        ],
      );

      await client.query(
        `INSERT INTO error_group_history (group_id, action, old_value, new_value, actor_id, metadata)
         VALUES ($1, 'merged', $2, $3, $4, $5)`,
        [
          targetGroupId,
          JSON.stringify({ occurrenceCount: target.occurrence_count }),
          JSON.stringify({ occurrenceCount: Number(target.occurrence_count) + sourceOccurrences }),
          actorId,
          JSON.stringify({ mergedFromId: sourceGroupId }),
        ],
      );

      return updatedTargetRes.rows[0] ?? null;
    });
  }
}
