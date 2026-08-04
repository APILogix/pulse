/**
 * Query parsing + validation for the /analytics/v2 read API.
 *
 * Contract: docs/analytics/08-dashboard-api-contracts.md §1
 *
 * Everything the client can influence is validated and normalised here, so the
 * repositories receive a trusted, fully-resolved scope. Sort columns are checked
 * against a per-route allowlist because they are interpolated into SQL.
 */
import { ALL_ENVIRONMENTS_SENTINEL, ALL_PROJECTS_SENTINEL, isWindowSize, } from '../types.js';
import { previousRange, selectWindow } from '../windows.js';
export class AnalyticsQueryError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, statusCode = 400, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'AnalyticsQueryError';
    }
}
/** Named ranges the UI offers (pulsiv_fe stores/timeRangeStore.ts TIME_RANGES). */
const NAMED_RANGES = {
    '5m': 5 * 60,
    '15m': 15 * 60,
    '30m': 30 * 60,
    '1h': 3_600,
    '6h': 6 * 3_600,
    '12h': 12 * 3_600,
    '24h': 24 * 3_600,
    '7d': 7 * 86_400,
    '30d': 30 * 86_400,
    '90d': 90 * 86_400,
};
const ENVIRONMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_RANGE_DAYS = 400;
function parseDate(value, field) {
    if (!value)
        return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new AnalyticsQueryError('INVALID_TIME_RANGE', `Invalid ${field} timestamp`);
    }
    return date;
}
/** Validated environment, or the cross-environment sentinel. */
export function parseEnvironment(value) {
    if (value === undefined || value === '' || value === 'all' || value === ALL_ENVIRONMENTS_SENTINEL) {
        return ALL_ENVIRONMENTS_SENTINEL;
    }
    const environment = value.trim();
    if (environment.length > 64 || !ENVIRONMENT_PATTERN.test(environment)) {
        throw new AnalyticsQueryError('INVALID_ENVIRONMENT', 'Invalid environment');
    }
    return environment;
}
export function parseSort(value, sortable, fallback) {
    if (!value)
        return fallback;
    const [column, direction = 'desc'] = value.split(':');
    if (!column || !sortable.includes(column)) {
        throw new AnalyticsQueryError('INVALID_SORT_COLUMN', `Cannot sort by ${column ?? 'unknown'}`, 400, {
            allowed: [...sortable],
        });
    }
    if (direction !== 'asc' && direction !== 'desc') {
        throw new AnalyticsQueryError('INVALID_SORT_COLUMN', 'Sort direction must be asc or desc');
    }
    return { column, direction };
}
/**
 * Resolves the full query scope.
 *
 * `from`/`to` are floored to the selected window before being returned, which is
 * what makes cache keys stable (the v1 API's implicit `to = new Date()` produced
 * a unique key per millisecond).
 */
export function parseScope(raw, options) {
    const now = options.now ?? new Date();
    let to = parseDate(raw.to, 'to');
    let from = parseDate(raw.from, 'from');
    if (!from && raw.range) {
        const seconds = NAMED_RANGES[raw.range];
        if (seconds === undefined) {
            throw new AnalyticsQueryError('INVALID_TIME_RANGE', `Unknown range ${raw.range}`, 400, {
                allowed: Object.keys(NAMED_RANGES),
            });
        }
        to = to ?? now;
        from = new Date(to.getTime() - seconds * 1_000);
    }
    to = to ?? now;
    from = from ?? new Date(to.getTime() - 24 * 3_600 * 1_000);
    if (to.getTime() <= from.getTime()) {
        throw new AnalyticsQueryError('INVALID_TIME_RANGE', '`to` must be after `from`');
    }
    const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
    if (spanDays > MAX_RANGE_DAYS) {
        throw new AnalyticsQueryError('ANALYTICS_WINDOW_TOO_LARGE', `Requested range exceeds ${MAX_RANGE_DAYS} days of retention`, 400, { maxDays: MAX_RANGE_DAYS });
    }
    const requestedWindow = raw.window
        ? (isWindowSize(raw.window)
            ? raw.window
            : (() => {
                throw new AnalyticsQueryError('INVALID_TIME_RANGE', `Unknown window ${raw.window}`);
            })())
        : undefined;
    const window = selectWindow(from, to, requestedWindow);
    const compare = raw.compare ?? 'previous';
    if (compare !== 'previous' && compare !== 'none') {
        throw new AnalyticsQueryError('INVALID_TIME_RANGE', 'compare must be previous or none');
    }
    const limitRaw = raw.limit ? Number.parseInt(raw.limit, 10) : undefined;
    const maxLimit = options.maxLimit ?? 200;
    const limit = Math.max(1, Math.min(limitRaw ?? options.defaultLimit ?? 20, maxLimit));
    const scope = {
        organizationId: options.organizationId,
        projectId: options.projectId ?? null,
        environment: parseEnvironment(raw.environment),
        range: { from, to },
        compareRange: compare === 'previous' ? previousRange(from, to) : null,
        window,
        limit,
        ...(raw.service ? { service: raw.service } : {}),
        ...(raw.release ? { release: raw.release } : {}),
        ...(raw.cursor ? { cursor: raw.cursor } : {}),
        ...(raw.q ? { q: raw.q } : {}),
    };
    const sort = parseSort(raw.sort, options.sortable ?? [], options.defaultSort);
    return sort ? { ...scope, sort } : scope;
}
/** The project_id value to filter rollups by, honouring the org-wide sentinel. */
export function projectFilter(scope) {
    return scope.projectId ?? ALL_PROJECTS_SENTINEL;
}
/** Stable cache key. Range is already window-floored by parseScope's callers. */
export function cacheKeyFor(route, scope, extra) {
    return [
        'v2',
        route,
        scope.organizationId,
        scope.projectId ?? 'org',
        scope.environment,
        scope.window,
        scope.range.from.toISOString(),
        scope.range.to.toISOString(),
        scope.compareRange ? 'cmp' : 'nocmp',
        scope.service ?? '-',
        scope.release ?? '-',
        String(scope.limit),
        scope.sort ? `${scope.sort.column}:${scope.sort.direction}` : '-',
        scope.q ?? '-',
        scope.cursor ?? '-',
        extra ?? '-',
    ].join(':');
}
export function isCsvRequested(raw) {
    return raw.format === 'csv';
}
//# sourceMappingURL=query-scope.js.map