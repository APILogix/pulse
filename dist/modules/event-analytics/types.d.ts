/**
 * Event-analytics module â€” types, Zod schemas, DTOs, and errors.
 *
 * Operates on the Pulse SDK event tables created in
 * migrations2/004_analytics_create_core_schema (events_*, analytics_*).
 *
 * Distinct from the existing project-scoped `analytics` module (telemetry).
 * This module is organization-scoped and read-optimized for dashboards.
 *
 * No caching / no rate limiting (per requirements). Tenant isolation is
 * enforced in the repository by always scoping queries on organization_id.
 */
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
export declare const TimeRangeKeySchema: z.ZodEnum<{
    "1h": "1h";
    "24h": "24h";
    "7d": "7d";
    "30d": "30d";
    "90d": "90d";
}>;
export type TimeRangeKey = z.infer<typeof TimeRangeKeySchema>;
export declare const GranularitySchema: z.ZodEnum<{
    week: "week";
    day: "day";
    hour: "hour";
}>;
export type Granularity = z.infer<typeof GranularitySchema>;
/** Milliseconds for each named range. */
export declare const RANGE_MS: Record<TimeRangeKey, number>;
export interface TimeRange {
    from: Date;
    to: Date;
}
export declare const UuidSchema: z.ZodString;
export declare const OrgIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const TimeRangeQuerySchema: z.ZodObject<{
    range: z.ZodDefault<z.ZodEnum<{
        "1h": "1h";
        "24h": "24h";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TimeRangeQuery = z.infer<typeof TimeRangeQuerySchema>;
export declare const TrendsQuerySchema: z.ZodObject<{
    range: z.ZodDefault<z.ZodEnum<{
        "1h": "1h";
        "24h": "24h";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
    granularity: z.ZodDefault<z.ZodEnum<{
        week: "week";
        day: "day";
        hour: "hour";
    }>>;
}, z.core.$strip>;
export type TrendsQuery = z.infer<typeof TrendsQuerySchema>;
export declare const PaginationSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const SeverityFilterSchema: z.ZodEnum<{
    error: "error";
    info: "info";
    debug: "debug";
    fatal: "fatal";
    warning: "warning";
}>;
export declare const ListErrorsQuerySchema: z.ZodObject<{
    range: z.ZodDefault<z.ZodEnum<{
        "1h": "1h";
        "24h": "24h";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    severity: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        debug: "debug";
        fatal: "fatal";
        warning: "warning";
    }>>;
    service: z.ZodOptional<z.ZodString>;
    release: z.ZodOptional<z.ZodString>;
    search: z.ZodOptional<z.ZodString>;
    fingerprint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ListErrorsQuery = z.infer<typeof ListErrorsQuerySchema>;
export declare const ListErrorGroupsQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        resolved: "resolved";
        unresolved: "unresolved";
        ignored: "ignored";
        muted: "muted";
    }>>;
    search: z.ZodOptional<z.ZodString>;
    sortBy: z.ZodDefault<z.ZodEnum<{
        last_seen_at: "last_seen_at";
        first_seen_at: "first_seen_at";
        total_count: "total_count";
    }>>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>;
export type ListErrorGroupsQuery = z.infer<typeof ListErrorGroupsQuerySchema>;
export declare const ResolveGroupSchema: z.ZodObject<{
    actorId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const RoutePerfQuerySchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    days: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type RoutePerfQuery = z.infer<typeof RoutePerfQuerySchema>;
export declare const ListRequestsQuerySchema: z.ZodObject<{
    range: z.ZodDefault<z.ZodEnum<{
        "1h": "1h";
        "24h": "24h";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    method: z.ZodOptional<z.ZodString>;
    statusCode: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    route: z.ZodOptional<z.ZodString>;
    slowOnly: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    errorOnly: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
}, z.core.$strip>;
export type ListRequestsQuery = z.infer<typeof ListRequestsQuerySchema>;
export declare const ListTracesQuerySchema: z.ZodObject<{
    range: z.ZodDefault<z.ZodEnum<{
        "1h": "1h";
        "24h": "24h";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type ListTracesQuery = z.infer<typeof ListTracesQuerySchema>;
export declare const MetricSeriesQuerySchema: z.ZodObject<{
    range: z.ZodDefault<z.ZodEnum<{
        "1h": "1h";
        "24h": "24h";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
    granularity: z.ZodDefault<z.ZodEnum<{
        week: "week";
        day: "day";
        hour: "hour";
    }>>;
    aggregate: z.ZodDefault<z.ZodEnum<{
        max: "max";
        min: "min";
        count: "count";
        avg: "avg";
        sum: "sum";
    }>>;
}, z.core.$strip>;
export type MetricSeriesQuery = z.infer<typeof MetricSeriesQuerySchema>;
export declare const ListLogsQuerySchema: z.ZodObject<{
    range: z.ZodDefault<z.ZodEnum<{
        "1h": "1h";
        "24h": "24h";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    level: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        debug: "debug";
        warn: "warn";
    }>>;
    search: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ListLogsQuery = z.infer<typeof ListLogsQuerySchema>;
export declare const ListSessionsQuerySchema: z.ZodObject<{
    range: z.ZodDefault<z.ZodEnum<{
        "1h": "1h";
        "24h": "24h";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    userId: z.ZodOptional<z.ZodString>;
    crashedOnly: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
}, z.core.$strip>;
export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;
export declare const CronHistoryQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    projectId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CreateDashboardSchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    layout: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    widgets: z.ZodDefault<z.ZodArray<z.ZodUnknown>>;
    isShared: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type CreateDashboardBody = z.infer<typeof CreateDashboardSchema>;
export declare const UpdateDashboardSchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    layout: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    widgets: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodUnknown>>>;
    isShared: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
}, z.core.$strip>;
export type UpdateDashboardBody = z.infer<typeof UpdateDashboardSchema>;
export declare const CreateSavedQuerySchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    queryType: z.ZodEnum<{
        custom: "custom";
        sql: "sql";
        builder: "builder";
    }>;
    queryConfig: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    visualizationType: z.ZodOptional<z.ZodEnum<{
        metric: "metric";
        table: "table";
        line: "line";
        bar: "bar";
        pie: "pie";
    }>>;
    visualizationConfig: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type CreateSavedQueryBody = z.infer<typeof CreateSavedQuerySchema>;
export declare const CreateAnalyticsAlertSchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    metric: z.ZodString;
    operator: z.ZodEnum<{
        gt: "gt";
        lt: "lt";
        gte: "gte";
        lte: "lte";
        eq: "eq";
    }>;
    threshold: z.ZodNumber;
    windowMinutes: z.ZodDefault<z.ZodNumber>;
    notificationChannels: z.ZodDefault<z.ZodArray<z.ZodString>>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type CreateAnalyticsAlertBody = z.infer<typeof CreateAnalyticsAlertSchema>;
export declare const ExportSchema: z.ZodObject<{
    dataset: z.ZodEnum<{
        requests: "requests";
        errors: "errors";
        metrics: "metrics";
        logs: "logs";
    }>;
    format: z.ZodDefault<z.ZodEnum<{
        json: "json";
        csv: "csv";
    }>>;
    range: z.ZodDefault<z.ZodEnum<{
        "1h": "1h";
        "24h": "24h";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
    projectId: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type ExportBody = z.infer<typeof ExportSchema>;
export interface Paginated<T> {
    data: T[];
    meta: {
        limit: number;
        offset: number;
        queryTimeMs: number;
    };
}
export interface RequestMeta {
    actorUserId: string;
    actorIp: string;
    actorUserAgent: string | null;
    requestId: string;
}
export declare class AnalyticsError extends AppError {
    constructor(message: string, code?: string, statusCode?: number, details?: Record<string, unknown>);
}
export declare class AnalyticsNotFoundError extends AnalyticsError {
    constructor(resource?: string);
}
export declare class InvalidTimeRangeError extends AnalyticsError {
    constructor(message?: string);
}
/** Resolve an explicit from/to or a named range into a concrete TimeRange. */
export declare function resolveTimeRange(q: {
    range?: TimeRangeKey | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
}): TimeRange;
//# sourceMappingURL=types.d.ts.map