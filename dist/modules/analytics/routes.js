import { authenticate } from "../../shared/middleware/auth.js";
const DEFAULT_CACHE_WINDOW_MS = 2 * 60 * 1_000;
export async function analyticsRoutes(fastify, _options) {
    fastify.get("/:projectId/events", { preHandler: [authenticate] }, async (request, reply) => {
        const { projectId } = request.params;
        const query = request.query;
        const eventQuery = parseEventListQuery(query);
        const result = await fastify.analytics.service.listEvents(projectId, eventQuery);
        return reply.send({
            meta: {
                projectId,
                totalEstimated: result.totalEstimated,
                returned: result.data.length,
                hasMore: result.hasMore,
                nextCursor: result.nextCursor,
                queryTimeMs: result.queryTimeMs,
                ...cacheMeta(result),
            },
            data: result.data,
        });
    });
    fastify.get("/:projectId/events/:eventId", { preHandler: [authenticate] }, async (request, reply) => {
        const { projectId, eventId } = request.params;
        const result = await fastify.analytics.service.getEventDetails(projectId, eventId);
        if (!result) {
            return notFound(reply, request, "EVENT_NOT_FOUND", "Event not found");
        }
        return reply.send({
            meta: {
                projectId,
                eventId,
                queryTimeMs: result.queryTimeMs,
                ...cacheMeta(result),
            },
            data: result.data,
        });
    });
    fastify.get("/:projectId/requests/overview", { preHandler: [authenticate] }, async (request, reply) => {
        const { projectId } = request.params;
        const range = parseTimeRange(request.query, 24 * 60 * 60 * 1_000);
        const result = await fastify.analytics.service.getRequestOverview(projectId, range);
        return reply.send({
            meta: {
                projectId,
                timeRange: toIsoRange(range),
                queryTimeMs: result.queryTimeMs,
                ...cacheMeta(result),
            },
            data: result.data,
        });
    });
    fastify.get("/:projectId/dashboard", { preHandler: [authenticate] }, async (request, reply) => {
        const { projectId } = request.params;
        const range = parseTimeRange(request.query, 24 * 60 * 60 * 1_000);
        const result = await fastify.analytics.service.getDashboard(projectId, range);
        return reply.send({
            meta: {
                projectId,
                timeRange: toIsoRange(range),
                generatedAt: new Date().toISOString(),
                queryTimeMs: result.queryTimeMs,
                ...cacheMeta(result),
            },
            data: result.data,
        });
    });
    fastify.get("/:projectId/error-groups", { preHandler: [authenticate] }, async (request, reply) => {
        const { projectId } = request.params;
        const query = request.query;
        const errorGroupQuery = {
            status: parseStatus(query.status),
            limit: parseLimit(query.limit, 25),
        };
        const priority = parseOptionalInt(query.priority);
        if (priority !== undefined) {
            Object.assign(errorGroupQuery, { priority });
        }
        if (query.cursor !== undefined) {
            Object.assign(errorGroupQuery, { cursor: query.cursor });
        }
        const result = await fastify.analytics.service.listErrorGroups(projectId, errorGroupQuery);
        return reply.send({
            meta: {
                projectId,
                totalEstimated: result.totalEstimated,
                returned: result.data.length,
                hasMore: result.hasMore,
                nextCursor: result.nextCursor,
                queryTimeMs: result.queryTimeMs,
                ...cacheMeta(result),
            },
            data: result.data,
        });
    });
    fastify.patch("/:projectId/error-groups/:fingerprint", { preHandler: [authenticate] }, async (request, reply) => {
        const { projectId, fingerprint } = request.params;
        const body = request.body;
        const update = {};
        if (body.priority !== undefined) {
            update.priority = body.priority;
        }
        if (body.isResolved !== undefined || body.is_resolved !== undefined) {
            const isResolved = body.isResolved ?? body.is_resolved;
            if (isResolved !== undefined) {
                update.isResolved = isResolved;
            }
        }
        if (body.resolvedBy !== undefined || body.resolved_by !== undefined) {
            const resolvedBy = body.resolvedBy ?? body.resolved_by;
            if (resolvedBy !== undefined) {
                update.resolvedBy = resolvedBy;
            }
        }
        const result = await fastify.analytics.service.updateErrorGroup(projectId, fingerprint, update);
        if (!result) {
            return notFound(reply, request, "ERROR_GROUP_NOT_FOUND", "Error group not found");
        }
        return reply.send({ meta: { projectId, fingerprint }, data: result });
    });
    fastify.post("/:projectId/error-groups/:fingerprint/resolve", { preHandler: [authenticate] }, async (request, reply) => {
        const { projectId, fingerprint } = request.params;
        const body = (request.body ?? {});
        const result = await fastify.analytics.service.resolveErrorGroup(projectId, fingerprint, body.resolvedBy ?? body.resolved_by);
        if (!result) {
            return notFound(reply, request, "ERROR_GROUP_NOT_FOUND", "Error group not found");
        }
        return reply.send({ meta: { projectId, fingerprint, resolvedAt: new Date().toISOString() }, data: result });
    });
    fastify.get("/:projectId/health", { preHandler: [authenticate] }, async (request, reply) => {
        const { projectId } = request.params;
        const result = await fastify.analytics.service.getHealth(projectId);
        return reply.status(result.status === "healthy" ? 200 : 503).send({ data: result });
    });
}
function parseEventListQuery(query) {
    const range = parseTimeRange(query, 7 * 24 * 60 * 60 * 1_000);
    const result = {
        ...range,
        limit: parseLimit(query.limit, 25),
        sort: parseSort(query.sort),
    };
    if (query.type === "error" || query.type === "request" || query.type === "custom") {
        result.type = query.type;
    }
    const statusCode = parseOptionalInt(query.statusCode ?? query.status_code);
    if (statusCode !== undefined) {
        result.statusCode = statusCode;
    }
    if (query.method) {
        result.method = query.method;
    }
    if (query.cursor) {
        result.cursor = query.cursor;
    }
    if (query.q) {
        result.searchQuery = query.q;
    }
    return result;
}
function parseTimeRange(query, fallbackMs) {
    const explicitTo = parseDate(query.to);
    // If the client does not pass `to`, using raw new Date() makes every request
    // produce a unique cache key down to the millisecond. Bucket the implicit
    // moving window into the same 2-minute window as the cache TTL so repeated
    // dashboard/list calls can actually reuse LRU/Redis entries.
    const to = explicitTo ?? floorDate(new Date(), DEFAULT_CACHE_WINDOW_MS);
    const from = parseDate(query.from) ?? new Date(to.getTime() - fallbackMs);
    return { from, to };
}
function floorDate(date, bucketMs) {
    return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs);
}
function parseDate(value) {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function parseLimit(value, fallback) {
    const parsed = parseOptionalInt(value);
    return Math.max(1, Math.min(parsed ?? fallback, 100));
}
function parseOptionalInt(value) {
    if (!value) {
        return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function parseSort(value) {
    return value === "asc" ? "asc" : "desc";
}
function parseStatus(value) {
    if (value === "resolved" || value === "unresolved") {
        return value;
    }
    return "all";
}
function toIsoRange(range) {
    return {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
    };
}
function cacheMeta(result) {
    const meta = {
        cacheHit: result.cacheHit,
        cacheLookupMs: result.cacheLookupMs,
    };
    if (result.cacheLayer !== undefined) {
        meta.cacheLayer = result.cacheLayer;
    }
    if (result.deduped !== undefined) {
        meta.deduped = result.deduped;
    }
    return meta;
}
function notFound(reply, request, code, message) {
    return reply.status(404).send({
        error: {
            code,
            message,
            requestId: request.id,
            timestamp: new Date().toISOString(),
        },
    });
}
//# sourceMappingURL=routes.js.map