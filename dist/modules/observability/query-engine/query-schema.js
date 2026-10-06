/**
 * HTTP → DSL translation. Validates raw query parameters (all strings on the
 * wire) and produces a typed {@link ExplorerQuery}. This is the only place raw
 * request input becomes a query object; the engine trusts what comes out.
 */
import { z } from 'zod';
import { QueryValidationError } from './errors.js';
export const RANGE_MS = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
};
const OPERATORS = [
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin',
    'contains', 'ncontains', 'startsWith', 'endsWith', 'exists', 'nexists', 'between',
];
const FilterClauseSchema = z.object({
    field: z.string().min(1).max(128),
    op: z.enum(OPERATORS),
    value: z.unknown().optional(),
});
/** Raw, wire-level query parameters shared by every explorer list endpoint. */
export const RawExplorerQuerySchema = z.object({
    search: z.string().trim().min(1).max(2000).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    range: z.enum(['15m', '1h', '6h', '24h', '3d', '7d', '30d', '90d']).optional(),
    environment: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).optional(),
    sort: z.string().trim().min(1).max(128).optional(),
    cursor: z.string().trim().min(1).max(4096).optional(),
    direction: z.enum(['forward', 'backward']).default('forward'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    filters: z.string().max(20000).optional(),
    status: z.union([z.string(), z.number()]).optional(),
    statusCode: z.union([z.string(), z.number()]).optional(),
    statusClass: z.string().optional(),
    rootSpanStatus: z.string().optional(),
    rootSpanName: z.string().optional(),
    service: z.string().optional(),
    method: z.string().optional(),
    duration: z.union([z.string(), z.number()]).optional(),
    durationMs: z.union([z.string(), z.number()]).optional(),
    project: z.string().optional(),
    projectSlug: z.string().optional(),
    severity: z.string().optional(),
    level: z.string().optional(),
    handled: z.union([z.string(), z.boolean()]).optional(),
    isHandled: z.union([z.string(), z.boolean()]).optional(),
    isRegression: z.union([z.string(), z.boolean()]).optional(),
    regression: z.union([z.string(), z.boolean()]).optional(),
    release: z.string().optional(),
    endpoint: z.string().optional(),
    route: z.string().optional(),
    sdkVersion: z.string().optional(),
    appVersion: z.string().optional(),
    minOccurrences: z.coerce.number().optional(),
}).strict();
/** Reject tenant and projection controls before endpoint-specific handling. */
export function assertPublicExplorerQuery(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
        return;
    const forbidden = ['projectId', 'project_id', 'organizationId', 'organization_id', 'orgId', 'org_id', 'fields', 'live'];
    const found = forbidden.find((key) => Object.prototype.hasOwnProperty.call(input, key));
    if (found)
        throw new QueryValidationError(`Query parameter '${found}' is not supported`);
}
/** Resolve explicit from/to or a named range into a concrete window. */
export function resolveTimeRange(raw) {
    const rangeMs = (raw.range && RANGE_MS[raw.range]) ? RANGE_MS[raw.range] : RANGE_MS['30d'];
    let from = raw.from;
    let to = raw.to;
    if (from && to) {
        if (from.getTime() === to.getTime()) {
            // User selected exact same start and end time/date (e.g. 2026-08-07 to 2026-08-07)
            // Expand 'to' by 24h (or rangeMs) so data for that day is included instead of matching 0 rows
            to = new Date(from.getTime() + (raw.range ? rangeMs : 24 * 60 * 60 * 1000));
        }
        else if (from > to) {
            // Swapped timestamps, fix order
            const temp = from;
            from = to;
            to = temp;
        }
        return { from, to };
    }
    if (from && !to) {
        // Only 'from' provided: set 'to' to from + rangeMs (default 24h)
        to = new Date(from.getTime() + rangeMs);
        return { from, to };
    }
    if (!from && to) {
        // Only 'to' provided: set 'from' to to - rangeMs (default 24h)
        from = new Date(to.getTime() - rangeMs);
        return { from, to };
    }
    // Neither from nor to provided: use relative range ending at now
    const now = new Date();
    to = now;
    from = new Date(now.getTime() - rangeMs);
    return { from, to };
}
/** Parse `field:dir` (dir optional) against the resource's default sort. */
function parseSort(raw, fallback) {
    if (!raw)
        return fallback;
    const [field, dir] = raw.split(':');
    if (!field)
        return fallback;
    const direction = dir === 'asc' ? 'asc' : dir === 'desc' ? 'desc' : fallback.direction;
    return { field, direction };
}
/** Parse the JSON-encoded structured filters parameter. */
function parseFilters(raw) {
    if (!raw)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new QueryValidationError('`filters` must be valid JSON');
    }
    const result = z.array(FilterClauseSchema).max(50).safeParse(parsed);
    if (!result.success) {
        throw new QueryValidationError('`filters` has an invalid shape', { issues: result.error.issues });
    }
    return result.data.map((c) => (c.value === undefined ? { field: c.field, op: c.op } : { field: c.field, op: c.op, value: c.value }));
}
/**
 * Build a validated {@link ExplorerQuery} from raw request query params.
 * `defaultSort` comes from the resource so each explorer keeps its natural
 * ordering (usually time DESC).
 */
export function buildExplorerQuery(rawInput, defaultSort) {
    assertPublicExplorerQuery(rawInput);
    const parsed = RawExplorerQuerySchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
        throw new QueryValidationError('Invalid explorer query', { issues: parsed.error.issues });
    }
    const raw = parsed.data;
    const timeInput = {};
    if (raw.from !== undefined)
        timeInput.from = raw.from;
    if (raw.to !== undefined)
        timeInput.to = raw.to;
    if (raw.range !== undefined)
        timeInput.range = raw.range;
    const timeRange = resolveTimeRange(timeInput);
    const sort = parseSort(raw.sort, defaultSort);
    const direction = raw.direction;
    const explicitFilters = parseFilters(raw.filters);
    // Status code / statusClass / rootSpanStatus
    const rawStatus = raw.statusCode ?? raw.status ?? raw.statusClass ?? raw.rootSpanStatus;
    if (rawStatus !== undefined && String(rawStatus).trim().length > 0) {
        const sStr = String(rawStatus).trim();
        if (sStr.endsWith('xx')) {
            const prefix = parseInt(sStr.charAt(0), 10);
            if (!isNaN(prefix)) {
                explicitFilters.push({ field: 'statusCode', op: 'gte', value: prefix * 100 });
                explicitFilters.push({ field: 'statusCode', op: 'lt', value: (prefix + 1) * 100 });
            }
        }
        else {
            const num = Number(sStr);
            if (Number.isFinite(num)) {
                explicitFilters.push({ field: 'statusCode', op: 'eq', value: num });
            }
            else if (['OPEN', 'RESOLVED', 'IGNORED', 'ARCHIVED'].includes(sStr.toUpperCase())) {
                explicitFilters.push({ field: 'status', op: 'eq', value: sStr.toUpperCase() });
            }
            else {
                explicitFilters.push({ field: 'rootSpanStatus', op: 'eq', value: sStr.toLowerCase() });
            }
        }
    }
    // Method
    if (raw.method !== undefined && raw.method.trim().length > 0) {
        explicitFilters.push({ field: 'method', op: 'eq', value: raw.method.trim().toUpperCase() });
    }
    // Duration
    const rawDur = raw.durationMs ?? raw.duration;
    if (rawDur !== undefined && String(rawDur).trim().length > 0) {
        const dStr = String(rawDur).trim();
        if (dStr.includes(':')) {
            const [opStr, numStr] = dStr.split(':');
            const num = Number(numStr);
            if (Number.isFinite(num)) {
                explicitFilters.push({ field: 'durationMs', op: opStr || 'gte', value: num });
            }
        }
        else {
            const num = Number(dStr);
            if (Number.isFinite(num)) {
                explicitFilters.push({ field: 'durationMs', op: 'gte', value: num });
            }
        }
    }
    // Project (slug)
    const rawProj = raw.projectSlug ?? raw.project;
    if (rawProj !== undefined && rawProj.trim().length > 0) {
        explicitFilters.push({ field: 'project', op: 'eq', value: rawProj.trim() });
    }
    // Severity / Level
    const rawSev = raw.severity ?? raw.level;
    if (rawSev !== undefined && rawSev.trim().length > 0) {
        explicitFilters.push({ field: 'severity', op: 'eq', value: rawSev.trim().toLowerCase() });
    }
    // Handled / Unhandled
    const rawHandled = raw.handled ?? raw.isHandled;
    if (rawHandled !== undefined && String(rawHandled).trim().length > 0) {
        const hStr = String(rawHandled).trim().toLowerCase();
        const boolVal = hStr === 'true' || hStr === '1' || hStr === 'handled';
        explicitFilters.push({ field: 'handled', op: 'eq', value: boolVal });
    }
    // Regression
    const rawRegression = raw.isRegression ?? raw.regression;
    if (rawRegression !== undefined && String(rawRegression).trim().length > 0) {
        const rStr = String(rawRegression).trim().toLowerCase();
        const boolVal = rStr === 'true' || rStr === '1' || rStr === 'regression';
        explicitFilters.push({ field: 'isRegression', op: 'eq', value: boolVal });
    }
    // Service
    if (raw.service !== undefined && raw.service.trim().length > 0) {
        explicitFilters.push({ field: 'service', op: 'eq', value: raw.service.trim() });
    }
    // Endpoint / Route
    const rawEndpoint = raw.endpoint ?? raw.route;
    if (rawEndpoint !== undefined && rawEndpoint.trim().length > 0) {
        explicitFilters.push({ field: 'endpoint', op: 'eq', value: rawEndpoint.trim() });
    }
    // Release
    if (raw.release !== undefined && raw.release.trim().length > 0) {
        explicitFilters.push({ field: 'release', op: 'eq', value: raw.release.trim() });
    }
    // SDK Version
    if (raw.sdkVersion !== undefined && raw.sdkVersion.trim().length > 0) {
        explicitFilters.push({ field: 'sdkVersion', op: 'eq', value: raw.sdkVersion.trim() });
    }
    // App Version
    if (raw.appVersion !== undefined && raw.appVersion.trim().length > 0) {
        explicitFilters.push({ field: 'appVersion', op: 'eq', value: raw.appVersion.trim() });
    }
    // Min Occurrences
    if (raw.minOccurrences !== undefined && !isNaN(raw.minOccurrences) && raw.minOccurrences > 0) {
        explicitFilters.push({ field: 'occurrenceCount', op: 'gte', value: raw.minOccurrences });
    }
    const query = {
        timeRange,
        filters: explicitFilters,
        sort,
        direction,
        limit: raw.limit,
    };
    if (raw.search !== undefined)
        query.search = raw.search;
    if (raw.environment !== undefined)
        query.environment = raw.environment;
    if (raw.cursor !== undefined)
        query.cursor = raw.cursor;
    return query;
}
//# sourceMappingURL=query-schema.js.map