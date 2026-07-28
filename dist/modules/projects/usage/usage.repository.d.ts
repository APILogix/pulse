import type { Pool, PoolClient } from "pg";
import type { HourlyUsage, DailyUsage } from "../types.js";
export declare class UsageRepository {
    private readonly db;
    constructor(db?: Pool);
    incrementHourly(projectId: string, orgId: string, hour: Date, eventCount: number, eventBytes: number, _categories: Record<string, number>, _eventTypes: Record<string, number>, client?: PoolClient): Promise<void>;
    incrementDaily(projectId: string, orgId: string, date: Date, eventCount: number, eventBytes: number, _categories: Record<string, number>, _eventTypes: Record<string, number>, client?: PoolClient): Promise<void>;
    getHourlyBreakdown(projectId: string, from: Date, to: Date, client?: PoolClient): Promise<HourlyUsage[]>;
    getDailyTrend(projectId: string, from: Date, to: Date, client?: PoolClient): Promise<DailyUsage[]>;
    getHourlyStats(projectId: string, hour: Date, client?: PoolClient): Promise<HourlyUsage | null>;
    getProjectOverview(organizationId: string, projectId: string, client?: PoolClient): Promise<{
        memberCount: number;
        apiKeyCount: number;
        totalEventsToday: number;
        totalBytesToday: number;
        peakHour: number;
        currentHourEvents: number;
        categoryBreakdown: Record<string, number>;
        eventTypeBreakdown: Record<string, number>;
        hourlyBreakdown: Array<{
            hour: number;
            eventCount: number;
            eventBytes: number;
            categories: Record<string, number>;
            eventTypes: Record<string, number>;
        }>;
        dailyTrend: Array<{
            date: string;
            totalEvents: number;
            totalBytes: number;
            changePercent: number;
        }>;
        heatmapData: Array<{
            hour: number;
            value: number;
            intensity: number;
        }>;
    }>;
    private mapHourlyRow;
    private mapDailyRow;
}
//# sourceMappingURL=usage.repository.d.ts.map