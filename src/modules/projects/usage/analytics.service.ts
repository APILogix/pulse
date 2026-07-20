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
import { LRUCache } from "lru-cache";
import { UsageAnalyticsRepository } from "./analytics.repository.js";
import { BaseProjectService } from "../shared/base.service.js";
import { ProjectMemberRole } from "../types.js";
import type {
  ComparisonQuery,
  HeatmapQuery,
  TopListQuery,
  UsageAnalyticsQuery,
  UsageAnalyticsResponse,
  HeatmapData,
  TopListItem,
  ComparisonSeries,
  MonthlyUsageVsPlan,
} from "./analytics.types.js";

const ANALYTICS_CACHE_TTL_MS = 1000 * 60 * 2; // 2 minutes
const ANALYTICS_CACHE_MAX = 1000;

type AnalyticsCacheValue =
  | UsageAnalyticsResponse
  | HeatmapData
  | TopListItem[]
  | ComparisonSeries[]
  | MonthlyUsageVsPlan[];

export class UsageAnalyticsService {
  private readonly cache: LRUCache<string, AnalyticsCacheValue>;

  constructor(
    private readonly repository: UsageAnalyticsRepository,
    private readonly base: BaseProjectService,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.cache = new LRUCache<string, AnalyticsCacheValue>({
      max: ANALYTICS_CACHE_MAX,
      ttl: ANALYTICS_CACHE_TTL_MS,
      updateAgeOnGet: true,
      allowStale: false,
    });
  }

  async getUsageAnalytics(
    orgId: string,
    projectId: string,
    userId: string,
    query: UsageAnalyticsQuery,
  ): Promise<UsageAnalyticsResponse> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);

    const cacheKey = this.cacheKey("usage", projectId, query);
    const cached = this.cache.get(cacheKey) as UsageAnalyticsResponse | undefined;
    if (cached) {
      this.logger.debug({ projectId }, "Usage analytics cache hit");
      return cached;
    }

    const [summary, timeSeries] = await Promise.all([
      this.repository.getSummary(projectId, query),
      this.repository.getTimeSeries(projectId, query),
    ]);

    const offset = query.cursor ? this.decodeCursor(query.cursor) : query.offset;
    const nextCursor = timeSeries.hasMore
      ? this.encodeCursor(offset + query.limit)
      : null;

    const response: UsageAnalyticsResponse = {
      summary,
      timeSeries: timeSeries.points,
      hasMore: timeSeries.hasMore,
      nextCursor,
    };

    this.cache.set(cacheKey, response);
    return response;
  }

  async getHeatmap(
    orgId: string,
    projectId: string,
    userId: string,
    query: HeatmapQuery,
  ): Promise<HeatmapData> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);

    const cacheKey = this.cacheKey("heatmap", projectId, query);
    const cached = this.cache.get(cacheKey) as HeatmapData | undefined;
    if (cached) return cached;

    let data: HeatmapData;
    switch (query.type) {
      case "hourly":
        data = await this.repository.getHourlyHeatmap(
          projectId,
          query.from,
          query.to,
          query.environmentId,
          query.apiKeyId,
        );
        break;
      case "dayOfWeek":
        data = await this.repository.getDayOfWeekHeatmap(
          projectId,
          query.from,
          query.to,
          query.environmentId,
          query.apiKeyId,
        );
        break;
      case "calendar":
      default:
        data = await this.repository.getCalendarHeatmap(
          projectId,
          query.from,
          query.to,
          query.environmentId,
          query.apiKeyId,
        );
        break;
    }

    this.cache.set(cacheKey, data);
    return data;
  }

  async getTopList(
    orgId: string,
    projectId: string,
    userId: string,
    query: TopListQuery,
  ): Promise<TopListItem[]> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);

    const cacheKey = this.cacheKey("top", projectId, query);
    const cached = this.cache.get(cacheKey) as TopListItem[] | undefined;
    if (cached) return cached;

    const result = await this.repository.getTopList(
      projectId,
      query.dimension,
      query.from,
      query.to,
      query.environmentId,
      query.apiKeyId,
      query.limit,
    );

    this.cache.set(cacheKey, result);
    return result;
  }

  async getComparison(
    orgId: string,
    projectId: string,
    userId: string,
    query: ComparisonQuery,
  ): Promise<ComparisonSeries[]> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);

    const cacheKey = this.cacheKey("comparison", projectId, query);
    const cached = this.cache.get(cacheKey) as ComparisonSeries[] | undefined;
    if (cached) return cached;

    const result = await this.repository.getComparison(
      projectId,
      query.dimension,
      query.from,
      query.to,
      query.limit,
    );

    this.cache.set(cacheKey, result);
    return result;
  }

  async getMonthlyUsageVsPlan(
    orgId: string,
    projectId: string,
    userId: string,
  ): Promise<MonthlyUsageVsPlan[]> {
    await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);

    const cacheKey = `monthly:${projectId}`;
    const cached = this.cache.get(cacheKey) as MonthlyUsageVsPlan[] | undefined;
    if (cached) return cached;

    const result = await this.repository.getMonthlyUsageVsPlan(projectId);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Evict analytics caches for a project. Called when ingestion writes new
   * aggregates or when a project is mutated so dashboards see fresh data.
   */
  evictProjectCache(projectId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`:${projectId}:`) || key === `monthly:${projectId}`) {
        this.cache.delete(key);
      }
    }
  }

  private cacheKey(method: string, projectId: string, query: Record<string, unknown>): string {
    // Strip cursor from cache key to avoid cache misses on pagination; the
    // underlying query is the same regardless of cursor.
    const { cursor, ...rest } = query;
    return `${method}:${projectId}:${JSON.stringify(rest)}`;
  }

  private encodeCursor(offset: number): string {
    return Buffer.from(String(offset), "utf8").toString("base64");
  }

  private decodeCursor(cursor: string): number {
    const value = Number.parseInt(Buffer.from(cursor, "base64").toString("utf8"), 10);
    return Number.isNaN(value) ? 0 : value;
  }
}
