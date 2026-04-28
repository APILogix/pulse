import { createHash } from "node:crypto";
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

export class AnalyticsService {
  private readonly shortTtlSeconds = 30;
  private readonly mediumTtlSeconds = 120;
  private readonly longTtlSeconds = 300;

  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly cache: AnalyticsCache,
  ) {}

  async listEvents(projectId: string, query: EventListQuery): Promise<PaginatedResult> {
    return this.cached(
      projectId,
      "events",
      query,
      this.shortTtlSeconds,
      () => this.timed(() => this.repository.listEvents(projectId, query)),
    );
  }

  async getEventDetails(projectId: string, eventId: string): Promise<{ data: EventDetails; queryTimeMs: number; cacheHit?: boolean } | null> {
    const result = await this.cached(
      projectId,
      "event-details",
      { eventId },
      this.longTtlSeconds,
      () => this.timedData(() => this.repository.getEventDetails(projectId, eventId)),
    );

    if (!result.data) {
      return null;
    }

    const response: { data: EventDetails; queryTimeMs: number; cacheHit?: boolean } = {
      data: result.data,
      queryTimeMs: result.queryTimeMs,
    };
    if (result.cacheHit !== undefined) {
      response.cacheHit = result.cacheHit;
    }
    return response;
  }

  async getRequestOverview(projectId: string, range: TimeRange): Promise<{ data: unknown; queryTimeMs: number; cacheHit?: boolean }> {
    return this.cached(
      projectId,
      "request-overview",
      range,
      this.mediumTtlSeconds,
      () => this.timedData(() => this.repository.getRequestOverview(projectId, range)),
    );
  }

  async getDashboard(projectId: string, range: TimeRange): Promise<{ data: DashboardData; queryTimeMs: number; cacheHit?: boolean }> {
    return this.cached(
      projectId,
      "dashboard",
      range,
      this.shortTtlSeconds,
      () => this.timedData(() => this.repository.getDashboard(projectId, range)),
    );
  }

  async listErrorGroups(projectId: string, query: ErrorGroupListQuery): Promise<PaginatedResult> {
    return this.cached(
      projectId,
      "error-groups",
      query,
      this.shortTtlSeconds,
      () => this.timed(() => this.repository.listErrorGroups(projectId, query)),
    );
  }

  async updateErrorGroup(projectId: string, fingerprint: string, update: ErrorGroupUpdate): Promise<unknown | null> {
    const result = await this.repository.updateErrorGroup(projectId, fingerprint, update);
    await this.cache.invalidateProject(projectId);
    return result;
  }

  async resolveErrorGroup(projectId: string, fingerprint: string, resolvedBy?: string): Promise<unknown | null> {
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
  ): Promise<T & { cacheHit?: boolean; cacheLayer?: "lru" | "redis" }> {
    const key = this.cacheKey(projectId, scope, input);
    const cached = await this.cache.get<T>(key);

    if (cached) {
      return {
        ...cached.data,
        queryTimeMs: 0,
        cacheHit: true,
        cacheLayer: cached.source,
      };
    }

    const result = await fetcher();
    await this.cache.set(key, result, ttlSeconds);
    return { ...result, cacheHit: false };
  }

  private async timed<T extends PaginatedResult>(fetcher: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    const result = await fetcher();
    return {
      ...result,
      queryTimeMs: Date.now() - startedAt,
    };
  }

  private async timedData<T>(fetcher: () => Promise<T>): Promise<{ data: T; queryTimeMs: number }> {
    const startedAt = Date.now();
    const data = await fetcher();
    return {
      data,
      queryTimeMs: Date.now() - startedAt,
    };
  }

  private cacheKey(projectId: string, scope: string, input: unknown): string {
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return `analytics:${scope}:${projectId}:${hash}`;
  }
}
