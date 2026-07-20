/**
 * Project usage analytics service.
 *
 * Flow:
 * 1. Authorize every read via requireProjectAccess (viewer or higher).
 * 2. Read from materialized time-series tables, never raw ingestion tables.
 * 3. Cache aggregated results for a short TTL to protect the dashboard from
 *    repeated expensive rollups.
 * 4. Encode cursor pagination as opaque base64 offsets.
 */
import type { FastifyBaseLogger } from "fastify";
import { UsageAnalyticsRepository } from "./analytics.repository.js";
import { BaseProjectService } from "../shared/base.service.js";
import type { ComparisonQuery, HeatmapQuery, TopListQuery, UsageAnalyticsQuery, UsageAnalyticsResponse, HeatmapData, TopListItem, ComparisonSeries, MonthlyUsageVsPlan } from "./analytics.types.js";
export declare class UsageAnalyticsService {
    private readonly repository;
    private readonly base;
    private readonly logger;
    private readonly cache;
    constructor(repository: UsageAnalyticsRepository, base: BaseProjectService, logger: FastifyBaseLogger);
    getUsageAnalytics(orgId: string, projectId: string, userId: string, query: UsageAnalyticsQuery): Promise<UsageAnalyticsResponse>;
    getHeatmap(orgId: string, projectId: string, userId: string, query: HeatmapQuery): Promise<HeatmapData>;
    getTopList(orgId: string, projectId: string, userId: string, query: TopListQuery): Promise<TopListItem[]>;
    getComparison(orgId: string, projectId: string, userId: string, query: ComparisonQuery): Promise<ComparisonSeries[]>;
    getMonthlyUsageVsPlan(orgId: string, projectId: string, userId: string): Promise<MonthlyUsageVsPlan[]>;
    /**
     * Evict analytics caches for a project. Called when ingestion writes new
     * aggregates or when a project is mutated so dashboards see fresh data.
     */
    evictProjectCache(projectId: string): void;
    private cacheKey;
    private encodeCursor;
    private decodeCursor;
}
//# sourceMappingURL=analytics.service.d.ts.map