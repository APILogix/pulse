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
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TIME RANGE + GRANULARITY
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export const TimeRangeKeySchema = z.enum(['1h', '24h', '7d', '30d', '90d']);
export const GranularitySchema = z.enum(['hour', 'day', 'week']);
/** Milliseconds for each named range. */
export const RANGE_MS = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
};
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COMMON SCHEMAS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export const UuidSchema = z.string().uuid();
export const OrgIdParamsSchema = z.object({ orgId: UuidSchema });
export const TimeRangeQuerySchema = z.object({
    range: TimeRangeKeySchema.default('24h'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    projectId: UuidSchema.optional(),
});
export const TrendsQuerySchema = TimeRangeQuerySchema.extend({
    granularity: GranularitySchema.default('hour'),
});
export const PaginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});
export const SeverityFilterSchema = z.enum(['debug', 'info', 'warning', 'error', 'fatal']);
// â”€â”€ Errors â”€â”€
export const ListErrorsQuerySchema = TimeRangeQuerySchema.merge(PaginationSchema).extend({
    severity: SeverityFilterSchema.optional(),
    service: z.string().max(100).optional(),
    release: z.string().max(100).optional(),
    search: z.string().max(500).optional(),
    fingerprint: z.string().max(64).optional(),
});
export const ListErrorGroupsQuerySchema = PaginationSchema.extend({
    projectId: UuidSchema.optional(),
    status: z.enum(['unresolved', 'resolved', 'ignored', 'muted']).optional(),
    search: z.string().max(256).optional(),
    sortBy: z.enum(['last_seen_at', 'first_seen_at', 'total_count']).default('last_seen_at'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export const ResolveGroupSchema = z.object({ actorId: UuidSchema.optional() });
// â”€â”€ Performance â”€â”€
export const RoutePerfQuerySchema = z.object({
    projectId: UuidSchema.optional(),
    days: z.coerce.number().int().min(1).max(90).default(7),
    limit: z.coerce.number().int().min(1).max(500).default(100),
});
// â”€â”€ Requests â”€â”€
export const ListRequestsQuerySchema = TimeRangeQuerySchema.merge(PaginationSchema).extend({
    method: z.string().max(10).optional(),
    statusCode: z.coerce.number().int().optional(),
    route: z.string().max(500).optional(),
    slowOnly: z.coerce.boolean().optional(),
    errorOnly: z.coerce.boolean().optional(),
});
// â”€â”€ Traces â”€â”€
export const ListTracesQuerySchema = TimeRangeQuerySchema.merge(PaginationSchema);
// â”€â”€ Metrics â”€â”€
export const MetricSeriesQuerySchema = TrendsQuerySchema.extend({
    aggregate: z.enum(['avg', 'sum', 'min', 'max', 'count']).default('avg'),
});
// â”€â”€ Logs â”€â”€
export const ListLogsQuerySchema = TimeRangeQuerySchema.merge(PaginationSchema).extend({
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    search: z.string().max(500).optional(),
});
// â”€â”€ Sessions / Users â”€â”€
export const ListSessionsQuerySchema = TimeRangeQuerySchema.merge(PaginationSchema).extend({
    userId: z.string().max(255).optional(),
    crashedOnly: z.coerce.boolean().optional(),
});
// â”€â”€ Crons â”€â”€
export const CronHistoryQuerySchema = PaginationSchema.extend({
    projectId: UuidSchema.optional(),
});
// â”€â”€ Dashboards â”€â”€
export const CreateDashboardSchema = z.object({
    projectId: UuidSchema.optional(),
    name: z.string().min(1).max(255).trim(),
    description: z.string().max(2000).optional(),
    layout: z.record(z.string(), z.unknown()).default({}),
    widgets: z.array(z.unknown()).default([]),
    isShared: z.boolean().default(false),
});
export const UpdateDashboardSchema = CreateDashboardSchema.partial();
// â”€â”€ Saved queries â”€â”€
export const CreateSavedQuerySchema = z.object({
    projectId: UuidSchema.optional(),
    name: z.string().min(1).max(255).trim(),
    description: z.string().max(2000).optional(),
    queryType: z.enum(['sql', 'builder', 'custom']),
    queryConfig: z.record(z.string(), z.unknown()),
    visualizationType: z.enum(['line', 'bar', 'pie', 'table', 'metric']).optional(),
    visualizationConfig: z.record(z.string(), z.unknown()).default({}),
});
// â”€â”€ Analytics alerts â”€â”€
export const CreateAnalyticsAlertSchema = z.object({
    projectId: UuidSchema.optional(),
    name: z.string().min(1).max(255).trim(),
    metric: z.string().min(1).max(100),
    operator: z.enum(['gt', 'lt', 'eq', 'gte', 'lte']),
    threshold: z.number(),
    windowMinutes: z.number().int().min(1).max(1440).default(5),
    notificationChannels: z.array(UuidSchema).default([]),
    isActive: z.boolean().default(true),
});
// â”€â”€ Export â”€â”€
export const ExportSchema = z.object({
    dataset: z.enum(['errors', 'requests', 'logs', 'metrics']),
    format: z.enum(['csv', 'json']).default('json'),
    range: TimeRangeKeySchema.default('24h'),
    projectId: UuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(10_000).default(1000),
});
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ERRORS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export class AnalyticsError extends AppError {
    constructor(message, code = 'ANALYTICS_ERROR', statusCode = 500, details) {
        super(message, code, statusCode, details);
    }
}
export class AnalyticsNotFoundError extends AnalyticsError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 'ANALYTICS_NOT_FOUND', 404);
    }
}
export class InvalidTimeRangeError extends AnalyticsError {
    constructor(message = 'Invalid time range') {
        super(message, 'INVALID_TIME_RANGE', 400);
    }
}
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
/** Resolve an explicit from/to or a named range into a concrete TimeRange. */
export function resolveTimeRange(q) {
    const to = q.to ?? new Date();
    if (q.from) {
        if (q.from >= to)
            throw new InvalidTimeRangeError('from must be before to');
        return { from: q.from, to };
    }
    const ms = RANGE_MS[q.range ?? '24h'];
    return { from: new Date(to.getTime() - ms), to };
}
//# sourceMappingURL=types.js.map