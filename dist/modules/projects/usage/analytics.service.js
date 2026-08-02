import { LRUCache } from "lru-cache";
import { UsageAnalyticsRepository } from "./analytics.repository.js";
import { BaseProjectService } from "../shared/base.service.js";
import { ProjectMemberRole } from "../types.js";
const ANALYTICS_CACHE_TTL_MS = 1000 * 60 * 2; // 2 minutes
const ANALYTICS_CACHE_MAX = 1000;
export class UsageAnalyticsService {
    repository;
    base;
    logger;
    cache;
    constructor(repository, base, logger) {
        this.repository = repository;
        this.base = base;
        this.logger = logger;
        this.cache = new LRUCache({
            max: ANALYTICS_CACHE_MAX,
            ttl: ANALYTICS_CACHE_TTL_MS,
            updateAgeOnGet: true,
            allowStale: false,
        });
    }
    async getUsageAnalytics(orgId, projectId, userId, query) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const cacheKey = this.cacheKey("usage", projectId, query);
        const cached = this.cache.get(cacheKey);
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
        const response = {
            summary,
            timeSeries: timeSeries.points,
            hasMore: timeSeries.hasMore,
            nextCursor,
        };
        this.cache.set(cacheKey, response);
        return response;
    }
    async getHeatmap(orgId, projectId, userId, query) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const cacheKey = this.cacheKey("heatmap", projectId, query);
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        let data;
        switch (query.type) {
            case "hourly":
                data = await this.repository.getHourlyHeatmap(projectId, query.from, query.to, query.environmentId, query.apiKeyId);
                break;
            case "dayOfWeek":
                data = await this.repository.getDayOfWeekHeatmap(projectId, query.from, query.to, query.environmentId, query.apiKeyId);
                break;
            case "calendar":
            default:
                data = await this.repository.getCalendarHeatmap(projectId, query.from, query.to, query.environmentId, query.apiKeyId);
                break;
        }
        this.cache.set(cacheKey, data);
        return data;
    }
    async getTopList(orgId, projectId, userId, query) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const cacheKey = this.cacheKey("top", projectId, query);
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        const result = await this.repository.getTopList(projectId, query.dimension, query.from, query.to, query.environmentId, query.apiKeyId, query.limit);
        this.cache.set(cacheKey, result);
        return result;
    }
    async getComparison(orgId, projectId, userId, query) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const cacheKey = this.cacheKey("comparison", projectId, query);
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        const result = await this.repository.getComparison(projectId, query.dimension, query.from, query.to, query.limit);
        this.cache.set(cacheKey, result);
        return result;
    }
    async getMonthlyUsageVsPlan(orgId, projectId, userId) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const cacheKey = `monthly:${projectId}`;
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached;
        const result = await this.repository.getMonthlyUsageVsPlan(projectId);
        this.cache.set(cacheKey, result);
        return result;
    }
    /**
     * Evict analytics caches for a project. Called when ingestion writes new
     * aggregates or when a project is mutated so dashboards see fresh data.
     */
    evictProjectCache(projectId) {
        for (const key of this.cache.keys()) {
            if (key.includes(`:${projectId}:`) || key === `monthly:${projectId}`) {
                this.cache.delete(key);
            }
        }
    }
    cacheKey(method, projectId, query) {
        // Strip cursor from cache key to avoid cache misses on pagination; the
        // underlying query is the same regardless of cursor.
        const { cursor, ...rest } = query;
        return `${method}:${projectId}:${JSON.stringify(rest)}`;
    }
    encodeCursor(offset) {
        return Buffer.from(String(offset), "utf8").toString("base64");
    }
    decodeCursor(cursor) {
        const value = Number.parseInt(Buffer.from(cursor, "base64").toString("utf8"), 10);
        return Number.isNaN(value) ? 0 : value;
    }
}
//# sourceMappingURL=analytics.service.js.map