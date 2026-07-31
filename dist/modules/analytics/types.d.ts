export type SortDirection = "asc" | "desc";
export interface TimeRange {
    from: Date;
    to: Date;
    environment?: string;
}
export interface EventListQuery extends TimeRange {
    type?: "error" | "request" | "custom";
    statusCode?: number;
    method?: string;
    cursor?: string;
    limit: number;
    sort: SortDirection;
    searchQuery?: string;
}
export interface ErrorGroupListQuery {
    status: "all" | "resolved" | "unresolved";
    environment?: string;
    priority?: number;
    limit: number;
    cursor?: string;
}
export interface PaginatedResult<T = unknown> {
    data: T[];
    hasMore: boolean;
    nextCursor: string | null;
    totalEstimated?: number;
    queryTimeMs: number;
    cache?: {
        hit: boolean;
        layer?: "lru" | "redis";
    };
}
export interface EventDetails {
    base: unknown;
    request: unknown | null;
    error: unknown | null;
    trace: unknown[];
}
export interface ErrorGroupUpdate {
    priority?: number;
    isResolved?: boolean;
    resolvedBy?: string;
}
export interface DashboardData {
    requests: unknown;
    errors: unknown;
    topEndpoints: unknown[];
    topErrors: unknown[];
    statusDistribution: unknown;
    generatedAt: string;
}
export interface AnalyticsHealth {
    status: "healthy" | "degraded";
    database: "connected" | "disconnected";
    cache: "connected" | "disconnected";
    checkedAt: string;
}
//# sourceMappingURL=types.d.ts.map