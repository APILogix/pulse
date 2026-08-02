import type { AnalyticsCache } from "./cache.js";
import type { AnalyticsRepository } from "./repository.js";
import type { AnalyticsHealth, DashboardData, ErrorGroupListQuery, ErrorGroupUpdate, EventDetails, EventListQuery, PaginatedResult, TimeRange } from "./types.js";
type CacheLayer = "lru" | "redis";
type CachedResult<T extends {
    queryTimeMs: number;
}> = T & {
    cacheHit: boolean;
    cacheLayer?: CacheLayer;
    cacheLookupMs: number;
    deduped?: boolean;
};
export declare class AnalyticsService {
    private readonly repository;
    private readonly cache;
    private readonly shortTtlSeconds;
    private readonly mediumTtlSeconds;
    private readonly longTtlSeconds;
    private readonly log;
    private readonly inFlight;
    constructor(repository: AnalyticsRepository, cache: AnalyticsCache);
    listEvents(projectId: string, query: EventListQuery): Promise<CachedResult<PaginatedResult>>;
    getEventDetails(projectId: string, eventId: string): Promise<{
        data: EventDetails;
        queryTimeMs: number;
        cacheHit: boolean;
        cacheLayer?: CacheLayer;
        cacheLookupMs: number;
        deduped?: boolean;
    } | null>;
    getRequestOverview(projectId: string, range: TimeRange): Promise<{
        data: unknown;
        queryTimeMs: number;
        cacheHit: boolean;
        cacheLayer?: CacheLayer;
        cacheLookupMs: number;
        deduped?: boolean;
    }>;
    getDashboard(projectId: string, range: TimeRange): Promise<{
        data: DashboardData;
        queryTimeMs: number;
        cacheHit: boolean;
        cacheLayer?: CacheLayer;
        cacheLookupMs: number;
        deduped?: boolean;
    }>;
    listErrorGroups(projectId: string, query: ErrorGroupListQuery): Promise<CachedResult<PaginatedResult>>;
    updateErrorGroup(projectId: string, fingerprint: string, update: ErrorGroupUpdate): Promise<unknown | null>;
    resolveErrorGroup(projectId: string, fingerprint: string, resolvedBy?: string): Promise<unknown | null>;
    getHealth(projectId: string): Promise<AnalyticsHealth>;
    private cached;
    private timed;
    private timedData;
    private cacheKey;
    private stableStringify;
}
export {};
//# sourceMappingURL=service.d.ts.map