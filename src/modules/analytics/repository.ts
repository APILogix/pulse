import type { PoolClient } from "pg";
import { logDB } from "../../config/log-database.js";
import type {
  DashboardData,
  ErrorGroupListQuery,
  ErrorGroupUpdate,
  EventDetails,
  EventListQuery,
  PaginatedResult,
  TimeRange,
} from "./types.js";

interface CursorPayload {
  timestamp: string;
  id: string;
}

/**
 * One read projection over the ten canonical typed event tables. The physical
 * tables stay separate for write throughput and retention, while this bounded
 * UNION gives the older project-scoped API a single event list without
 * restoring the removed generic events/request_events/error_events schema.
 */
const UNIFIED_EVENTS_SQL = `
  SELECT id,event_id,'error'::text AS type,project_id,environment,occurred_at AS timestamp,
         payload,status_code,NULL::text AS method,NULL::text AS url,
         NULL::numeric AS latency_ms,message,error_name,service,trace_id,user_id
    FROM events_errors
  UNION ALL
  SELECT id,event_id,'request'::text,project_id,environment,occurred_at AS timestamp,
         payload,status_code,method,url,latency_ms,message,NULL::text,service,trace_id,user_id
    FROM events_requests
  UNION ALL
  SELECT id,event_id,'log'::text,project_id,environment,occurred_at AS timestamp,
         payload,status_code,NULL::text,NULL::text,NULL::numeric,message,NULL::text,service,trace_id,user_id
    FROM events_logs
  UNION ALL
  SELECT id,event_id,'metric'::text,project_id,environment,occurred_at AS timestamp,
         payload,status_code,NULL::text,NULL::text,NULL::numeric,message,NULL::text,service,trace_id,user_id
    FROM events_metrics
  UNION ALL
  SELECT id,event_id,'span'::text,project_id,environment,occurred_at AS timestamp,
         payload,status_code,NULL::text,NULL::text,NULL::numeric,message,NULL::text,service,trace_id,user_id
    FROM events_spans
  UNION ALL
  SELECT id,event_id,'trace'::text,project_id,environment,occurred_at AS timestamp,
         payload,status_code,NULL::text,NULL::text,NULL::numeric,message,NULL::text,service,trace_id,user_id
    FROM events_traces
  UNION ALL
  SELECT id,event_id,'message'::text,project_id,environment,occurred_at AS timestamp,
         payload,status_code,NULL::text,NULL::text,NULL::numeric,message,NULL::text,service,trace_id,user_id
    FROM events_messages
  UNION ALL
  SELECT id,event_id,'profile'::text,project_id,environment,occurred_at AS timestamp,
         payload,status_code,NULL::text,NULL::text,NULL::numeric,message,NULL::text,service,trace_id,user_id
    FROM events_profiles
  UNION ALL
  SELECT id,event_id,'replay'::text,project_id,environment,occurred_at AS timestamp,
         payload,status_code,NULL::text,NULL::text,NULL::numeric,message,NULL::text,service,trace_id,user_id
    FROM events_replays
  UNION ALL
  SELECT id,event_id,'cron_checkin'::text,project_id,environment,occurred_at AS timestamp,
         payload,status_code,NULL::text,NULL::text,NULL::numeric,message,NULL::text,service,trace_id,user_id
    FROM events_cron_checkins
`;

export class AnalyticsRepository {
  private readonly maxLimit = 100;

  constructor(private readonly db = logDB.getPrimaryPool()) {}

  async listEvents(projectId: string, query: EventListQuery): Promise<PaginatedResult> {
    const limit = this.clampLimit(query.limit);
    const params: unknown[] = [projectId, query.from, query.to];
    const where = ["e.project_id = $1", "e.occurred_at BETWEEN $2 AND $3"];
    let index = params.length;

    if (query.environment) {
      params.push(query.environment);
      where.push(`e.environment = $${++index}`);
    }
    if (query.type === "error" || query.type === "request") {
      params.push(query.type);
      where.push(`e.type = $${++index}`);
    } else if (query.type === "custom") {
      where.push("e.type NOT IN ('error','request')");
    }
    if (query.statusCode !== undefined) {
      params.push(query.statusCode);
      where.push(`e.status_code = $${++index}`);
    }
    if (query.method) {
      params.push(query.method.toUpperCase());
      where.push(`e.method = $${++index}`);
    }
    if (query.searchQuery) {
      params.push(`%${query.searchQuery}%`);
      const searchParam = ++index;
      where.push(`(e.payload::text ILIKE $${searchParam} OR e.message ILIKE $${searchParam} OR e.url ILIKE $${searchParam})`);
    }

    const cursor = this.decodeCursor(query.cursor);
    if (cursor) {
      params.push(cursor.timestamp, cursor.id);
      const operator = query.sort === "asc" ? ">" : "<";
      where.push(`(e.occurred_at,e.id) ${operator} ($${++index},$${++index})`);
    }

    params.push(limit + 1);
    const limitParam = ++index;
    const order = query.sort === "asc" ? "ASC" : "DESC";
    const whereSql = where.join(" AND ");

    return this.withProjectContext(projectId, async (client) => {
      const startedAt = Date.now();
      const result = await client.query(
        `WITH unified_events AS (${UNIFIED_EVENTS_SQL})
         SELECT e.id,e.event_id,e.type,e.environment,e.occurred_at,e.method,e.url,
                e.status_code,e.latency_ms,e.service,e.trace_id,
                (e.type='error' OR COALESCE(e.status_code,0) >= 500) AS has_error
           FROM unified_events e
          WHERE ${whereSql}
          ORDER BY e.occurred_at ${order},e.id ${order}
          LIMIT $${limitParam}`,
        params,
      );
      const hasMore = result.rows.length > limit;
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      return {
        data: rows.map((row) => ({
          id: row.id,
          eventId: row.event_id,
          type: row.type,
          environment: row.environment,
          timestamp: row.timestamp,
          method: row.method,
          url: row.url,
          statusCode: row.status_code,
          latencyMs: row.latency_ms,
          service: row.service,
          traceId: row.trace_id,
          hasError: row.has_error,
        })),
        hasMore,
        nextCursor: hasMore && last ? this.encodeCursor(last.occurred_at, last.id) : null,
        queryTimeMs: Date.now() - startedAt,
      };
    });
  }

  async getEventDetails(projectId: string, eventId: string): Promise<EventDetails | null> {
    return this.withProjectContext(projectId, async (client) => {
      const event = await client.query(
        `WITH unified_events AS (${UNIFIED_EVENTS_SQL})
         SELECT * FROM unified_events
          WHERE project_id=$1 AND id=$2
          LIMIT 1`,
        [projectId, eventId],
      );
      const row = event.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;

      const traceId = typeof row.trace_id === "string" ? row.trace_id : null;
      const environment = typeof row.environment === "string" ? row.environment : null;
      let trace: unknown[] = [];
      if (traceId && environment) {
        const related = await client.query(
          `SELECT 'trace'::text AS type,to_jsonb(t) AS details,t.occurred_at
             FROM events_traces t
            WHERE t.project_id=$1 AND t.trace_id=$2 AND t.environment=$3
           UNION ALL
           SELECT 'span'::text,to_jsonb(s),s.occurred_at
             FROM events_spans s
            WHERE s.project_id=$1 AND s.trace_id=$2 AND s.environment=$3
           UNION ALL
           SELECT 'request'::text,to_jsonb(r),r.occurred_at
             FROM events_requests r
            WHERE r.project_id=$1 AND r.trace_id=$2 AND r.environment=$3
           UNION ALL
           SELECT 'error'::text,to_jsonb(e),e.occurred_at
             FROM events_errors e
            WHERE e.project_id=$1 AND e.trace_id=$2 AND e.environment=$3
           ORDER BY occurred_at ASC`,
          [projectId, traceId, environment],
        );
        trace = related.rows.map((relatedRow) => ({
          type: relatedRow.type,
          ...(relatedRow.details as Record<string, unknown>),
        }));
      }

      return {
        base: row,
        request: row.type === "request" ? row : null,
        error: row.type === "error" ? row : null,
        trace,
      };
    });
  }

  async getRequestOverview(projectId: string, range: TimeRange): Promise<unknown> {
    return this.one(
      projectId,
      `SELECT jsonb_build_object(
         'total_requests',COUNT(*),
         'avg_latency_ms',COALESCE(ROUND(AVG(latency_ms)),0),
         'p95_latency_ms',COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms),0),
         'error_count',COUNT(*) FILTER (WHERE status_code >= 500),
         'error_rate_pct',COALESCE(ROUND(COUNT(*) FILTER (WHERE status_code >= 500) * 100.0 / NULLIF(COUNT(*),0),2),0),
         'unique_users',COUNT(DISTINCT user_id)
       ) AS data
       FROM events_requests
       WHERE project_id=$1 AND occurred_at BETWEEN $2 AND $3
         AND ($4::text IS NULL OR environment=$4)`,
      [projectId, range.from, range.to, range.environment ?? null],
    );
  }

  async getDashboard(projectId: string, range: TimeRange): Promise<DashboardData> {
    return this.withProjectContext(projectId, async (client) => {
      const params = [projectId, range.from, range.to, range.environment ?? null];
      const [requests, errors, endpoints, topErrors, status] = await Promise.all([
        this.queryData(client,
          `SELECT jsonb_build_object(
             'total',COUNT(*),
             'avg_latency_ms',COALESCE(ROUND(AVG(latency_ms)),0),
             'p95_latency_ms',COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms),0),
             'error_rate_pct',COALESCE(ROUND(COUNT(*) FILTER (WHERE status_code >= 500) * 100.0 / NULLIF(COUNT(*),0),2),0)
           ) AS data
           FROM events_requests
           WHERE project_id=$1 AND occurred_at BETWEEN $2 AND $3
             AND ($4::text IS NULL OR environment=$4)`, params),
        this.queryData(client,
          `SELECT jsonb_build_object(
             'total',COALESCE(SUM(total_count),0),
             'unresolved',COUNT(*) FILTER (WHERE status<>'resolved'),
             'critical',COUNT(*) FILTER (WHERE priority=1 AND status<>'resolved')
           ) AS data
           FROM analytics_error_groups
           WHERE project_id=$1 AND last_seen_at BETWEEN $2 AND $3
             AND ($4::text IS NULL OR $4=ANY(environments))`, params),
        this.queryRows(client,
          `SELECT md5(COALESCE(url,'') || COALESCE(method,'')) AS endpoint_hash,
                  url,method,COUNT(*)::int AS requests,
                  COALESCE(ROUND(AVG(latency_ms)),0)::int AS avg_latency_ms
             FROM events_requests
            WHERE project_id=$1 AND occurred_at BETWEEN $2 AND $3
              AND ($4::text IS NULL OR environment=$4) AND url IS NOT NULL
            GROUP BY url,method ORDER BY requests DESC LIMIT 10`, params),
        this.queryRows(client,
          `SELECT fingerprint,error_name,message_template AS last_message,
                  total_count AS occurrences,priority,(status='resolved') AS is_resolved,
                  last_seen_at AS last_seen,environments
             FROM analytics_error_groups
            WHERE project_id=$1 AND last_seen_at BETWEEN $2 AND $3
              AND ($4::text IS NULL OR $4=ANY(environments))
            ORDER BY total_count DESC LIMIT 10`, params),
        this.queryData(client,
          `SELECT jsonb_build_object(
             '2xx',COUNT(*) FILTER (WHERE status_code BETWEEN 200 AND 299),
             '3xx',COUNT(*) FILTER (WHERE status_code BETWEEN 300 AND 399),
             '4xx',COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499),
             '5xx',COUNT(*) FILTER (WHERE status_code >= 500)
           ) AS data
           FROM events_requests
           WHERE project_id=$1 AND occurred_at BETWEEN $2 AND $3
             AND ($4::text IS NULL OR environment=$4)`, params),
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

  async listErrorGroups(projectId: string, query: ErrorGroupListQuery): Promise<PaginatedResult> {
    const limit = this.clampLimit(query.limit);
    const params: unknown[] = [projectId];
    const where = ["project_id=$1"];
    let index = params.length;

    if (query.environment) {
      params.push(query.environment);
      where.push(`$${++index}=ANY(environments)`);
    }
    if (query.status === "resolved") where.push("status='resolved'");
    if (query.status === "unresolved") where.push("status<>'resolved'");
    if (query.priority !== undefined) {
      params.push(query.priority);
      where.push(`priority=$${++index}`);
    }
    if (query.cursor) {
      params.push(query.cursor);
      where.push(`last_seen_at < $${++index}`);
    }

    params.push(limit + 1);
    const limitParam = ++index;
    const whereSql = where.join(" AND ");
    return this.withProjectContext(projectId, async (client) => {
      const startedAt = Date.now();
      const [items, count] = await Promise.all([
        client.query(
          `SELECT *,total_count AS occurrences,last_seen_at AS last_seen,
                  (status='resolved') AS is_resolved
             FROM analytics_error_groups
            WHERE ${whereSql}
            ORDER BY last_seen_at DESC
            LIMIT $${limitParam}`,
          params,
        ),
        client.query(
          `SELECT COUNT(*)::int AS total FROM analytics_error_groups WHERE ${whereSql}`,
          params.slice(0, -1),
        ),
      ]);
      const rows = items.rows.slice(0, limit);
      const last = rows.at(-1);
      return {
        data: rows,
        totalEstimated: Number(count.rows[0]?.total ?? 0),
        hasMore: items.rows.length > limit,
        nextCursor: items.rows.length > limit && last
          ? new Date(last.last_seen_at).toISOString()
          : null,
        queryTimeMs: Date.now() - startedAt,
      };
    });
  }

  async updateErrorGroup(
    projectId: string,
    fingerprint: string,
    update: ErrorGroupUpdate,
  ): Promise<unknown | null> {
    const sets = ["updated_at=NOW()"];
    const params: unknown[] = [projectId, fingerprint];
    let index = params.length;

    if (update.priority !== undefined) {
      params.push(update.priority);
      sets.push(`priority=$${++index}`);
    }
    if (update.isResolved !== undefined) {
      params.push(update.isResolved);
      const resolvedParam = ++index;
      sets.push(`status=CASE WHEN $${resolvedParam} THEN 'resolved' ELSE 'unresolved' END`);
      sets.push(`resolved_at=CASE WHEN $${resolvedParam} THEN NOW() ELSE NULL END`);
      if (!update.isResolved) sets.push("resolved_by=NULL");
    }
    if (update.resolvedBy !== undefined) {
      params.push(update.resolvedBy);
      sets.push(`resolved_by=$${++index}`);
      sets.push(`assigned_to=$${index}`);
    }

    return this.withProjectContext(projectId, async (client) => {
      const result = await client.query(
        `UPDATE analytics_error_groups
            SET ${sets.join(",")}
          WHERE project_id=$1 AND fingerprint=$2
          RETURNING *,total_count AS occurrences,last_seen_at AS last_seen,
                    (status='resolved') AS is_resolved`,
        params,
      );
      return result.rows[0] ?? null;
    });
  }

  async checkHealth(projectId: string): Promise<boolean> {
    try {
      await this.withProjectContext(projectId, (client) => client.query("SELECT 1"));
      return true;
    } catch {
      return false;
    }
  }

  private async one(projectId: string, sql: string, params: unknown[]): Promise<unknown> {
    return this.withProjectContext(projectId, (client) => this.queryData(client, sql, params));
  }

  private async queryData(client: PoolClient, sql: string, params: unknown[]): Promise<unknown> {
    const result = await client.query(sql, params);
    return result.rows[0]?.data ?? null;
  }

  private async queryRows(client: PoolClient, sql: string, params: unknown[]): Promise<unknown[]> {
    const result = await client.query(sql, params);
    return result.rows;
  }

  private async withProjectContext<T>(
    projectId: string,
    callback: (client: PoolClient) => Promise<T> | T,
  ): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_project_id',$1,true)", [projectId]);
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private clampLimit(limit: number): number {
    return Math.max(1, Math.min(limit, this.maxLimit));
  }

  private encodeCursor(timestamp: Date | string, id: string): string {
    return Buffer.from(JSON.stringify({
      timestamp: new Date(timestamp).toISOString(),
      id,
    } satisfies CursorPayload)).toString("base64url");
  }

  private decodeCursor(cursor?: string): CursorPayload | null {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
      if (
        typeof parsed.timestamp !== "string"
        || Number.isNaN(new Date(parsed.timestamp).getTime())
        || typeof parsed.id !== "string"
        || parsed.id.length === 0
      ) return null;
      return { timestamp: parsed.timestamp, id: parsed.id };
    } catch {
      return null;
    }
  }
}
