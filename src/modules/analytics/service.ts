import { createHash } from "node:crypto";
import { logger } from "../../config/logger.js";
import type { AnalyticsCache } from "./cache.js";
import type { AnalyticsRepository } from "./repository.js";
import type {
  AnalyticsHealth,
  DashboardData,
  ErrorGroupListQuery,
  ErrorGroupUpdate,
  EventDetails,
  EventListQuery,
  PaginatedResult,
  TimeRange,
} from "./types.js";

type CacheLayer = "lru" | "redis";

type TimedResult = { queryTimeMs: number };

type CachedResult<T extends { queryTimeMs: number }> = T & {
  cacheHit: boolean;
  cacheLayer?: CacheLayer;
  cacheLookupMs: number;
  deduped?: boolean;
};

export class AnalyticsService {
  private readonly shortTtlSeconds = 120;
  private readonly mediumTtlSeconds = 120;
  private readonly longTtlSeconds = 300;
  private readonly log = logger.child({ component: "analytics-service" });
  private readonly inFlight = new Map<
    string,
    Promise<{ result: TimedResult }>
  >();

  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly cache: AnalyticsCache,
  ) {}

  async listEvents(
    projectId: string,
    query: EventListQuery,
  ): Promise<CachedResult<PaginatedResult>> {
    return this.cached(projectId, "events", query, this.shortTtlSeconds, () =>
      this.timed(() => this.repository.listEvents(projectId, query)),
    );
  }

  async getEventDetails(
    projectId: string,
    eventId: string,
  ): Promise<{
    data: EventDetails;
    queryTimeMs: number;
    cacheHit: boolean;
    cacheLayer?: CacheLayer;
    cacheLookupMs: number;
    deduped?: boolean;
  } | null> {
    const result = await this.cached(
      projectId,
      "event-details",
      { eventId },
      this.longTtlSeconds,
      () =>
        this.timedData(() =>
          this.repository.getEventDetails(projectId, eventId),
        ),
    );

    if (!result.data) {
      return null;
    }

    const response: {
      data: EventDetails;
      queryTimeMs: number;
      cacheHit: boolean;
      cacheLayer?: CacheLayer;
      cacheLookupMs: number;
      deduped?: boolean;
    } = {
      data: result.data,
      queryTimeMs: result.queryTimeMs,
      cacheHit: result.cacheHit,
      cacheLookupMs: result.cacheLookupMs,
    };
    if (result.cacheLayer !== undefined) {
      response.cacheLayer = result.cacheLayer;
    }
    if (result.deduped !== undefined) {
      response.deduped = result.deduped;
    }
    return response;
  }

  async getRequestOverview(
    projectId: string,
    range: TimeRange,
  ): Promise<{
    data: unknown;
    queryTimeMs: number;
    cacheHit: boolean;
    cacheLayer?: CacheLayer;
    cacheLookupMs: number;
    deduped?: boolean;
  }> {
    return this.cached(
      projectId,
      "request-overview",
      range,
      this.mediumTtlSeconds,
      () =>
        this.timedData(() =>
          this.repository.getRequestOverview(projectId, range),
        ),
    );
  }

  async getDashboard(
    projectId: string,
    range: TimeRange,
  ): Promise<{
    data: DashboardData;
    queryTimeMs: number;
    cacheHit: boolean;
    cacheLayer?: CacheLayer;
    cacheLookupMs: number;
    deduped?: boolean;
  }> {
    return this.cached(
      projectId,
      "dashboard",
      range,
      this.shortTtlSeconds,
      () =>
        this.timedData(() => this.repository.getDashboard(projectId, range)),
    );
  }

  async listErrorGroups(
    projectId: string,
    query: ErrorGroupListQuery,
  ): Promise<CachedResult<PaginatedResult>> {
    return this.cached(
      projectId,
      "error-groups",
      query,
      this.shortTtlSeconds,
      () => this.timed(() => this.repository.listErrorGroups(projectId, query)),
    );
  }

  async updateErrorGroup(
    projectId: string,
    fingerprint: string,
    update: ErrorGroupUpdate,
  ): Promise<unknown | null> {
    const result = await this.repository.updateErrorGroup(
      projectId,
      fingerprint,
      update,
    );
    await this.cache.invalidateProject(projectId);
    return result;
  }

  async resolveErrorGroup(
    projectId: string,
    fingerprint: string,
    resolvedBy?: string,
  ): Promise<unknown | null> {
    const update: ErrorGroupUpdate = { isResolved: true };
    if (resolvedBy !== undefined) {
      update.resolvedBy = resolvedBy;
    }
    return this.updateErrorGroup(projectId, fingerprint, update);
  }

  async getHealth(projectId: string): Promise<AnalyticsHealth> {
    const [database, cache] = await Promise.all([
      this.repository.checkHealth(projectId),
      this.cache.isHealthy(),
    ]);

    return {
      status: database && cache ? "healthy" : "degraded",
      database: database ? "connected" : "disconnected",
      cache: cache ? "connected" : "disconnected",
      checkedAt: new Date().toISOString(),
    };
  }

  private async cached<T extends { queryTimeMs: number }>(
    projectId: string,
    scope: string,
    input: unknown,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<CachedResult<T>> {
    const lookupStartedAt = Date.now();
    const key = this.cacheKey(projectId, scope, input);
    const cached = await this.cache.get<T>(key);
    if (cached) {
      const cacheLookupMs = Date.now() - lookupStartedAt;
      this.log.debug(
        { key, projectId, scope, cacheLayer: cached.source, cacheLookupMs },
        "analytics cache served response",
      );
      return {
        ...cached.data,
        queryTimeMs: 0,
        cacheHit: true,
        cacheLayer: cached.source,
        cacheLookupMs,
      };
    }

    const cacheLookupMs = Date.now() - lookupStartedAt;

    // Without this map, a burst of identical cache misses would run the same
    // expensive analytics query once per request. The first request owns the DB
    // fetch and cache population; followers await that promise.
    const existing = this.inFlight.get(key);
    if (existing) {
      const { result } = (await existing) as { result: T; deduped: boolean };
      this.log.debug(
        { key, projectId, scope, cacheLookupMs },
        "analytics cache miss joined in-flight fetch",
      );
      return {
        ...result,
        cacheHit: false,
        cacheLookupMs,
        deduped: true,
      };
    }

    const promise = (async (): Promise<{ result: T; deduped: boolean }> => {
      const result = await fetcher();
      await this.cache.set(key, result, ttlSeconds);
      return { result, deduped: false };
    })();

    this.inFlight.set(key, promise);
    try {
      const { result } = await promise;
      this.log.debug(
        {
          key,
          projectId,
          scope,
          ttlSeconds,
          queryTimeMs: result.queryTimeMs,
          cacheLookupMs,
        },
        "analytics cache populated after miss",
      );
      return {
        ...result,
        cacheHit: false,
        cacheLookupMs,
      };
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async timed<T extends PaginatedResult>(
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    const result = await fetcher();
    return {
      ...result,
      queryTimeMs: Date.now() - startedAt,
    };
  }

  private async timedData<T>(
    fetcher: () => Promise<T>,
  ): Promise<{ data: T; queryTimeMs: number }> {
    const startedAt = Date.now();
    const data = await fetcher();
    return {
      data,
      queryTimeMs: Date.now() - startedAt,
    };
  }

  private cacheKey(projectId: string, scope: string, input: unknown): string {
    const stableInput = this.stableStringify(input);
    const hash = createHash("sha256")
      .update(stableInput)
      .digest("hex");
    return `analytics:${scope}:${projectId}:${hash}`;
  }

  private stableStringify(input: unknown): string {
    const seen = new WeakSet<object>();

    const normalize = (value: unknown): unknown => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      if (Array.isArray(value)) {
        return value.map((item) => normalize(item));
      }
      if (value && typeof value === "object") {
        if (seen.has(value)) {
          throw new TypeError("Cannot build analytics cache key for cyclic input");
        }
        seen.add(value);

        const normalized: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
          const item = (value as Record<string, unknown>)[key];
          if (item !== undefined) {
            normalized[key] = normalize(item);
          }
        }
        seen.delete(value);
        return normalized;
      }
      return value;
    };

    // JSON.stringify preserves object insertion order. Sorting object keys here
    // makes semantically identical filter objects produce the same cache key.
    return JSON.stringify(normalize(input));
  }
}
