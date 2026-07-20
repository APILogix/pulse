/**
 * Project usage analytics repository.
 *
 * Reads from materialized time-series tables (minute, hourly, daily) and
 * api_key_usage_minute. Never queries raw ingestion tables.
 */
import type { Pool, PoolClient } from "pg";
import type { UsageAnalyticsQuery, UsageSummary, UsageTimeSeriesPoint, HeatmapData, TopListItem, ComparisonSeries, MonthlyUsageVsPlan } from "./analytics.types.js";
type DbClient = Pool | PoolClient;
export declare class UsageAnalyticsRepository {
    private readonly db;
    constructor(db?: Pool);
    private whereClause;
    getSummary(projectId: string, query: UsageAnalyticsQuery, client?: DbClient): Promise<UsageSummary>;
    getTimeSeries(projectId: string, query: UsageAnalyticsQuery, client?: DbClient): Promise<{
        points: UsageTimeSeriesPoint[];
        hasMore: boolean;
    }>;
    getCalendarHeatmap(projectId: string, from: Date, to: Date, environmentId?: string, apiKeyId?: string, client?: DbClient): Promise<HeatmapData>;
    getHourlyHeatmap(projectId: string, from: Date, to: Date, environmentId?: string, apiKeyId?: string, client?: DbClient): Promise<HeatmapData>;
    getDayOfWeekHeatmap(projectId: string, from: Date, to: Date, environmentId?: string, apiKeyId?: string, client?: DbClient): Promise<HeatmapData>;
    getTopList(projectId: string, dimension: string, from: Date, to: Date, environmentId?: string, apiKeyId?: string, limit?: number, client?: DbClient): Promise<TopListItem[]>;
    getComparison(projectId: string, dimension: "environment" | "apiKey", from: Date, to: Date, limit?: number, client?: DbClient): Promise<ComparisonSeries[]>;
    getMonthlyUsageVsPlan(projectId: string, client?: DbClient): Promise<MonthlyUsageVsPlan[]>;
    private pickGranularity;
    private mapSummaryRow;
    private mapTimeSeriesRow;
}
export {};
//# sourceMappingURL=analytics.repository.d.ts.map