import type { Pool, PoolClient } from "pg";
import { pool } from "../../../config/database.js";
import type { HourlyUsage, DailyUsage } from "../types.js";

type CanonicalUsageRow = {
  id: string;
  project_id: string;
  organization_id: string;
  bucket: Date;
  total_events: string;
  total_bytes: string;
  created_at: Date;
};

export class UsageRepository {
  constructor(private readonly db: Pool = pool) {}

  async incrementHourly(
    projectId: string,
    orgId: string,
    hour: Date,
    eventCount: number,
    eventBytes: number,
    _categories: Record<string, number>,
    _eventTypes: Record<string, number>,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    await db.query(
      `INSERT INTO project_usage_hourly
        (project_id, organization_id, bucket, bucket_hour, total_events, event_bytes)
       VALUES ($1, $2, $3, $3, $4, $5)
       ON CONFLICT (project_id, bucket) DO UPDATE SET
         total_events = project_usage_hourly.total_events + EXCLUDED.total_events,
         event_bytes = project_usage_hourly.event_bytes + EXCLUDED.event_bytes`,
      [projectId, orgId, hour, eventCount, eventBytes],
    );
  }

  async incrementDaily(
    projectId: string,
    orgId: string,
    date: Date,
    eventCount: number,
    eventBytes: number,
    _categories: Record<string, number>,
    _eventTypes: Record<string, number>,
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? this.db;
    await db.query(
      `INSERT INTO project_usage_daily
        (project_id, organization_id, bucket, total_events, total_bytes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, project_id, environment_id, api_key_id, bucket) DO UPDATE SET
         total_events = project_usage_daily.total_events + EXCLUDED.total_events,
         total_bytes = project_usage_daily.total_bytes + EXCLUDED.total_bytes`,
      [projectId, orgId, date, eventCount, eventBytes],
    );
  }

  async getHourlyBreakdown(
    projectId: string,
    from: Date,
    to: Date,
    client?: PoolClient,
  ): Promise<HourlyUsage[]> {
    const db = client ?? this.db;
    const result = await db.query<CanonicalUsageRow>(
      `SELECT id, project_id, organization_id, bucket, total_events, event_bytes::text AS total_bytes, created_at
       FROM project_usage_hourly
       WHERE project_id = $1 AND bucket >= $2 AND bucket <= $3
       ORDER BY bucket ASC`,
      [projectId, from, to],
    );
    return result.rows.map(this.mapHourlyRow);
  }

  async getDailyTrend(
    projectId: string,
    from: Date,
    to: Date,
    client?: PoolClient,
  ): Promise<DailyUsage[]> {
    const db = client ?? this.db;
    const result = await db.query<CanonicalUsageRow>(
      `SELECT id, project_id, organization_id, bucket, total_events, total_bytes, created_at
       FROM project_usage_daily
       WHERE project_id = $1 AND bucket >= $2 AND bucket <= $3
       ORDER BY bucket ASC`,
      [projectId, from, to],
    );
    return result.rows.map(this.mapDailyRow);
  }

  async getHourlyStats(
    projectId: string,
    hour: Date,
    client?: PoolClient,
  ): Promise<HourlyUsage | null> {
    const db = client ?? this.db;
    const result = await db.query<CanonicalUsageRow>(
      `SELECT id, project_id, organization_id, bucket, total_events, event_bytes::text AS total_bytes, created_at
       FROM project_usage_hourly
       WHERE project_id = $1 AND bucket = $2
       LIMIT 1`,
      [projectId, hour],
    );
    return result.rows[0] ? this.mapHourlyRow(result.rows[0]) : null;
  }

  async getProjectOverview(
    organizationId: string,
    projectId: string,
    client?: PoolClient,
  ): Promise<{
    memberCount: number;
    apiKeyCount: number;
    totalEventsToday: number;
    totalBytesToday: number;
    peakHour: number;
    currentHourEvents: number;
    categoryBreakdown: Record<string, number>;
    eventTypeBreakdown: Record<string, number>;
    hourlyBreakdown: Array<{ hour: number; eventCount: number; eventBytes: number; categories: Record<string, number>; eventTypes: Record<string, number> }>;
    dailyTrend: Array<{ date: string; totalEvents: number; totalBytes: number; changePercent: number }>;
    heatmapData: Array<{ hour: number; value: number; intensity: number }>;
  }> {
    const db = client ?? this.db;
    const [summary, hourly, daily, heatmap, eventTypes] = await Promise.all([
      db.query<{ member_count: string; api_key_count: string; total_events: string; total_bytes: string; current_hour_events: string }>(
        `SELECT
           (SELECT COUNT(*) FROM project_members WHERE organization_id=$1 AND project_id=$2 AND status='active')::text member_count,
           (SELECT COUNT(*) FROM project_api_keys WHERE organization_id=$1 AND project_id=$2 AND deleted_at IS NULL)::text api_key_count,
           COALESCE(SUM(total_events),0)::text total_events,
           '0'::text total_bytes,
           COALESCE(SUM(total_events) FILTER(WHERE bucket>=date_trunc('hour',NOW())),0)::text current_hour_events
         FROM project_usage_minute
        WHERE organization_id=$1 AND project_id=$2 AND bucket>=date_trunc('day',NOW())`,
        [organizationId, projectId],
      ),
      db.query<{ bucket: Date; total_events: string; total_bytes: string }>(
        `SELECT date_trunc('hour',bucket) bucket,SUM(total_events)::text total_events,SUM(event_bytes)::text total_bytes
           FROM project_usage_hourly
          WHERE organization_id=$1 AND project_id=$2 AND bucket>=date_trunc('hour',NOW())-INTERVAL '23 hours'
          GROUP BY date_trunc('hour',bucket) ORDER BY bucket`,
        [organizationId, projectId],
      ),
      db.query<{ bucket: Date; total_events: string; total_bytes: string }>(
        `SELECT date_trunc('day',bucket) bucket,SUM(total_events)::text total_events,SUM(total_bytes)::text total_bytes
           FROM project_usage_daily
          WHERE organization_id=$1 AND project_id=$2 AND bucket>=date_trunc('day',NOW())-INTERVAL '13 days'
          GROUP BY date_trunc('day',bucket) ORDER BY bucket`,
        [organizationId, projectId],
      ),
      db.query<{ bucket_hour: number; total_events: string }>(
        `SELECT EXTRACT(HOUR FROM bucket)::int AS bucket_hour,SUM(total_events)::text AS total_events
           FROM project_usage_hourly
          WHERE organization_id=$1 AND project_id=$2 AND bucket>=NOW()-INTERVAL '7 days'
          GROUP BY EXTRACT(HOUR FROM bucket) ORDER BY bucket_hour`,
        [organizationId, projectId],
      ),
      db.query<{ event_type: string; total_events: string }>(
        `SELECT m.event_type,SUM(m.events)::text total_events
           FROM api_key_usage_minute m
          WHERE m.organization_id=$1 AND m.project_id=$2 AND m.bucket>=date_trunc('day',NOW()) AND m.event_type <> '__all__'
          GROUP BY m.event_type ORDER BY SUM(m.events) DESC`,
        [organizationId, projectId],
      ),
    ]);

    const summaryRow = summary.rows[0];
    const hourlyRows = hourly.rows.map((row) => ({
      hour: row.bucket.getUTCHours(),
      eventCount: Number(row.total_events),
      eventBytes: Number(row.total_bytes),
      categories: {},
      eventTypes: {},
    }));
    const dailyRows = daily.rows.map((row, index, rows) => {
      const totalEvents = Number(row.total_events);
      const previous = index > 0 ? Number(rows[index - 1]!.total_events) : 0;
      return {
        date: row.bucket.toISOString().slice(0, 10),
        totalEvents,
        totalBytes: Number(row.total_bytes),
        changePercent: previous > 0 ? ((totalEvents - previous) / previous) * 100 : 0,
      };
    });
    const heatValues = heatmap.rows.map((row) => Number(row.total_events));
    const maxHeat = Math.max(0, ...heatValues);
    const peak = hourly.rows.reduce<{ hour: number; events: number }>(
      (best, row) => Number(row.total_events) > best.events
        ? { hour: row.bucket.getUTCHours(), events: Number(row.total_events) }
        : best,
      { hour: 0, events: -1 },
    );

    return {
      memberCount: Number(summaryRow?.member_count ?? 0),
      apiKeyCount: Number(summaryRow?.api_key_count ?? 0),
      totalEventsToday: Number(summaryRow?.total_events ?? 0),
      totalBytesToday: Number(summaryRow?.total_bytes ?? 0),
      peakHour: peak.hour,
      currentHourEvents: Number(summaryRow?.current_hour_events ?? 0),
      categoryBreakdown: {},
      eventTypeBreakdown: Object.fromEntries(eventTypes.rows.map((row) => [row.event_type, Number(row.total_events)])),
      hourlyBreakdown: hourlyRows,
      dailyTrend: dailyRows,
      heatmapData: heatmap.rows.map((row) => {
        const value = Number(row.total_events);
        return { hour: Number(row.bucket_hour), value, intensity: maxHeat > 0 ? value / maxHeat : 0 };
      }),
    };
  }

  private mapHourlyRow(row: CanonicalUsageRow): HourlyUsage {
    return {
      id: row.id,
      projectId: row.project_id,
      organizationId: row.organization_id,
      bucketHour: row.bucket,
      eventCount: Number.parseInt(row.total_events, 10),
      eventBytes: Number.parseInt(row.total_bytes, 10),
      categoryCounts: {},
      eventTypeCounts: {},
      createdAt: row.created_at,
    };
  }

  private mapDailyRow(row: CanonicalUsageRow): DailyUsage {
    return {
      id: row.id,
      projectId: row.project_id,
      organizationId: row.organization_id,
      bucketDate: row.bucket.toISOString().split("T")[0]!,
      totalEvents: Number.parseInt(row.total_events, 10),
      totalBytes: Number.parseInt(row.total_bytes, 10),
      categoryCounts: {},
      eventTypeCounts: {},
      peakEventsPerHour: 0,
      createdAt: row.created_at,
    };
  }
}
