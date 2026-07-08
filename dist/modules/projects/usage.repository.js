import { pool } from "../../config/database.js";
export class UsageRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async incrementHourly(projectId, orgId, hour, eventCount, eventBytes, categories, eventTypes, client) {
        const db = client ?? this.db;
        await db.query(`INSERT INTO project_usage_hourly 
        (project_id, organization_id, bucket_hour, event_count, event_bytes, category_counts, event_type_counts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, bucket_hour) DO UPDATE SET
         event_count = project_usage_hourly.event_count + EXCLUDED.event_count,
         event_bytes = project_usage_hourly.event_bytes + EXCLUDED.event_bytes,
         category_counts = project_usage_hourly.category_counts || EXCLUDED.category_counts,
         event_type_counts = project_usage_hourly.event_type_counts || EXCLUDED.event_type_counts`, [projectId, orgId, hour, eventCount, eventBytes, JSON.stringify(categories), JSON.stringify(eventTypes)]);
    }
    async incrementDaily(projectId, orgId, date, eventCount, eventBytes, categories, eventTypes, client) {
        const db = client ?? this.db;
        await db.query(`INSERT INTO project_usage_daily 
        (project_id, organization_id, bucket_date, total_events, total_bytes, category_counts, event_type_counts)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, bucket_date) DO UPDATE SET
         total_events = project_usage_daily.total_events + EXCLUDED.total_events,
         total_bytes = project_usage_daily.total_bytes + EXCLUDED.total_bytes,
         category_counts = project_usage_daily.category_counts || EXCLUDED.category_counts,
         event_type_counts = project_usage_daily.event_type_counts || EXCLUDED.event_type_counts`, [projectId, orgId, date, eventCount, eventBytes, JSON.stringify(categories), JSON.stringify(eventTypes)]);
    }
    async getHourlyBreakdown(projectId, from, to, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT * FROM project_usage_hourly
       WHERE project_id = $1 AND bucket_hour >= $2 AND bucket_hour <= $3
       ORDER BY bucket_hour ASC`, [projectId, from, to]);
        return result.rows.map(this.mapHourlyRow);
    }
    async getDailyTrend(projectId, from, to, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT * FROM project_usage_daily
       WHERE project_id = $1 AND bucket_date >= $2 AND bucket_date <= $3
       ORDER BY bucket_date ASC`, [projectId, from, to]);
        return result.rows.map(this.mapDailyRow);
    }
    async getHourlyStats(projectId, hour, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT * FROM project_usage_hourly
       WHERE project_id = $1 AND bucket_hour = $2
       LIMIT 1`, [projectId, hour]);
        return result.rows[0] ? this.mapHourlyRow(result.rows[0]) : null;
    }
    mapHourlyRow(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            organizationId: row.organization_id,
            bucketHour: row.bucket_hour,
            eventCount: parseInt(row.event_count, 10),
            eventBytes: parseInt(row.event_bytes, 10),
            categoryCounts: row.category_counts || {},
            eventTypeCounts: row.event_type_counts || {},
            createdAt: row.created_at,
        };
    }
    mapDailyRow(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            organizationId: row.organization_id,
            bucketDate: row.bucket_date.toISOString().split("T")[0],
            totalEvents: parseInt(row.total_events, 10),
            totalBytes: parseInt(row.total_bytes, 10),
            categoryCounts: row.category_counts || {},
            eventTypeCounts: row.event_type_counts || {},
            peakEventsPerHour: row.peak_events_per_hour,
            createdAt: row.created_at,
        };
    }
}
//# sourceMappingURL=usage.repository.js.map