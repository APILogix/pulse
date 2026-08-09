import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { QueryValidationError } from './query-engine/errors.js';
const RANGE_MS = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '3d': 3 * 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
};
const ReleaseQuerySchema = z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    range: z.enum(['15m', '1h', '6h', '24h', '3d', '7d', '30d', '90d']).optional(),
    search: z.string().trim().min(1).max(2000).optional(),
    environment: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(4096).optional(),
    sort: z.enum(['releasedAt:asc', 'releasedAt:desc']).default('releasedAt:desc'),
    direction: z.enum(['forward', 'backward']).default('forward'),
}).strict();
function secret() {
    const value = process.env.AUTH_TOKEN_SECRET;
    if (value && value.length >= 32)
        return value;
    if (process.env.NODE_ENV === 'test')
        return 'observability-release-cursor-test-secret';
    throw new Error('AUTH_TOKEN_SECRET must be configured for release cursors');
}
function sign(value) {
    return createHmac('sha256', secret()).update(value).digest('base64url');
}
function resolveQuery(raw) {
    const parsed = ReleaseQuerySchema.parse(raw ?? {});
    const to = parsed.to ?? new Date();
    const from = parsed.from ?? new Date(to.getTime() - RANGE_MS[parsed.range ?? '30d']);
    if (from >= to)
        throw new QueryValidationError('`from` must be before `to`');
    if (to.getTime() - from.getTime() > RANGE_MS['90d']) {
        throw new QueryValidationError('Release query range cannot exceed 90 days');
    }
    if (parsed.search !== undefined && parsed.search.length < 3) {
        throw new QueryValidationError('Search terms must contain at least 3 characters');
    }
    return { ...parsed, from, to };
}
function scopeFingerprint(ctx, query) {
    const scope = JSON.stringify({
        organizationId: ctx.organizationId,
        projectId: ctx.projectId ?? null,
        allowedProjectIds: [...(ctx.allowedProjectIds ?? [])].sort(),
        from: query.from.toISOString(),
        to: query.to.toISOString(),
        environment: query.environment ?? null,
        search: query.search ?? null,
        sort: query.sort,
    });
    return sign(scope);
}
function encodeCursor(payload) {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${encoded}.${sign(encoded)}`;
}
function decodeCursor(value, scope, direction) {
    const [encoded, signature] = value.split('.');
    if (!encoded || !signature)
        throw new QueryValidationError('Malformed release cursor');
    const expected = Buffer.from(sign(encoded), 'base64url');
    const received = Buffer.from(signature, 'base64url');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        throw new QueryValidationError('Invalid release cursor');
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    }
    catch {
        throw new QueryValidationError('Malformed release cursor');
    }
    if (typeof payload !== 'object' || payload === null)
        throw new QueryValidationError('Malformed release cursor');
    const cursor = payload;
    if (cursor.v !== 1
        || typeof cursor.t !== 'string'
        || Number.isNaN(new Date(cursor.t).getTime())
        || typeof cursor.id !== 'string'
        || cursor.id.length === 0
        || cursor.d !== direction
        || cursor.s !== scope
        || typeof cursor.e !== 'number'
        || cursor.e <= Date.now()) {
        throw new QueryValidationError('Release cursor does not match this query');
    }
    return cursor;
}
function escapeLike(value) {
    return value.replace(/([%_\\])/g, '\\$1');
}
export class ObservabilityReleasesRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async list(ctx, rawQuery) {
        const query = resolveQuery(rawQuery);
        const sortDirection = query.sort.endsWith(':asc') ? 'asc' : 'desc';
        const backward = query.direction === 'backward';
        const scanDirection = backward ? (sortDirection === 'asc' ? 'desc' : 'asc') : sortDirection;
        const params = [ctx.organizationId, query.from, query.to];
        const predicates = [
            'r.organization_id = $1',
            'r.released_at >= $2',
            'r.released_at < $3',
        ];
        if (ctx.projectId) {
            params.push(ctx.projectId);
            predicates.push(`r.project_id = $${params.length}`);
        }
        else if (ctx.allowedProjectIds !== undefined) {
            if (ctx.allowedProjectIds.length === 0)
                return this.emptyResponse(query);
            params.push(ctx.allowedProjectIds);
            predicates.push(`r.project_id = ANY($${params.length}::uuid[])`);
        }
        if (query.environment) {
            params.push(query.environment);
            predicates.push(`pe.slug = $${params.length}`);
        }
        if (query.search) {
            params.push(`%${escapeLike(query.search)}%`);
            predicates.push(`(r.version ILIKE $${params.length} OR r.branch ILIKE $${params.length} OR r.commit_sha ILIKE $${params.length})`);
        }
        const cursorScope = scopeFingerprint(ctx, query);
        if (query.cursor) {
            const cursor = decodeCursor(query.cursor, cursorScope, sortDirection);
            params.push(new Date(cursor.t), cursor.id);
            const operator = scanDirection === 'desc' ? '<' : '>';
            predicates.push(`(r.released_at, r.id) ${operator} ($${params.length - 1}, $${params.length})`);
        }
        params.push(query.limit + 1);
        const rows = await this.pool.query(`SELECT r.id, r.released_at, r.version, r.commit_sha, r.branch, pe.slug AS environment
         FROM project_releases r
         JOIN project_environments pe ON pe.id = r.environment_id AND pe.project_id = r.project_id
        WHERE ${predicates.join(' AND ')}
        ORDER BY r.released_at ${scanDirection.toUpperCase()}, r.id ${scanDirection.toUpperCase()}
        LIMIT $${params.length}`, params);
        const hasMore = rows.rows.length > query.limit;
        let page = hasMore ? rows.rows.slice(0, query.limit) : rows.rows;
        if (backward)
            page = page.reverse();
        const first = page[0];
        const last = page[page.length - 1];
        const makeCursor = (row) => row
            ? encodeCursor({
                v: 1,
                t: new Date(row.released_at).toISOString(),
                id: row.id,
                d: sortDirection,
                s: cursorScope,
                e: Date.now() + 15 * 60 * 1000,
            })
            : null;
        return {
            success: true,
            items: page.map((row) => ({
                version: row.version,
                commitSha: row.commit_sha,
                branch: row.branch,
                environment: row.environment,
                releasedAt: row.released_at,
            })),
            pagination: {
                nextCursor: hasMore && last ? makeCursor(last) : null,
                previousCursor: query.cursor && first ? makeCursor(first) : null,
                hasNext: backward ? Boolean(query.cursor) : hasMore,
                hasPrevious: backward ? hasMore : Boolean(query.cursor),
                limit: query.limit,
                direction: query.direction,
            },
            query: {
                from: query.from.toISOString(),
                to: query.to.toISOString(),
                search: query.search ?? null,
                environment: query.environment ?? null,
                sort: query.sort,
            },
        };
    }
    emptyResponse(query) {
        return {
            success: true,
            items: [],
            pagination: {
                nextCursor: null,
                previousCursor: null,
                hasNext: false,
                hasPrevious: false,
                limit: query.limit,
                direction: query.direction,
            },
            query: {
                from: query.from.toISOString(),
                to: query.to.toISOString(),
                search: query.search ?? null,
                environment: query.environment ?? null,
                sort: query.sort,
            },
        };
    }
}
//# sourceMappingURL=releases.repository.js.map