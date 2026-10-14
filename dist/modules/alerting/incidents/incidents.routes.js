import { authenticate } from '../../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../../shared/middleware/requireorg.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { OrgIdParamsSchema } from '../types.js';
import { AssignIncidentBodySchema, IncidentIdParamsSchema, IncidentTimelineQuerySchema, ListActivityQuerySchema, ListIncidentsQuerySchema, ResolveIncidentBodySchema, RuleIncidentStatsQuerySchema, } from './incidents.types.js';
function buildMeta(request) {
    const ua = request.headers['user-agent'];
    return {
        actorUserId: request.user.id,
        actorIp: request.ip ?? '0.0.0.0',
        actorUserAgent: typeof ua === 'string' ? ua : null,
        requestId: request.id,
    };
}
function handleError(error, reply) {
    if (error instanceof AppError) {
        return reply.code(error.statusCode).send({
            success: false,
            error: {
                code: error.code,
                message: error.message,
                ...(error.details ? { details: error.details } : {}),
            },
        });
    }
    return reply.code(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Unexpected alerting error' },
    });
}
function withErrorHandling(handler) {
    return async (request, reply) => {
        try {
            return await handler(request, reply);
        }
        catch (error) {
            request.log.error({ err: error, path: request.url }, 'Alerting route failed');
            return handleError(error, reply);
        }
    };
}
export async function incidentsRoutes(fastify) {
    const svc = fastify.alerting.incidents;
    const guard = { preHandler: [authenticate, requireOrgAccess] };
    /**
     * Paginated incident list.
     *
     * Filtering, sorting and pagination are all executed in SQL. The response is
     * bounded by `limit` no matter how much history the tenant has, so this endpoint
     * cannot be turned into a full-table transfer by a client.
     */
    fastify.get('/incidents', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = ListIncidentsQuerySchema.parse(request.query ?? {});
        const result = await svc.listIncidents(orgId, query);
        return reply.send({
            success: true,
            data: result.data,
            meta: {
                total: result.total,
                limit: query.limit,
                offset: query.offset,
                hasMore: query.offset + result.data.length < result.total,
            },
        });
    }));
    /**
     * Global cross-incident activity feed (Phase 22).
     *
     * Registered BEFORE `/incidents/:incidentId` so the static segment is
     * unambiguous, and paginated so an unbounded history is never returned.
     */
    fastify.get('/incidents/activity', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = ListActivityQuerySchema.parse(request.query ?? {});
        const result = await svc.getActivity(orgId, query);
        return reply.send({
            success: true,
            data: result.data,
            meta: {
                total: result.total,
                limit: query.limit,
                offset: query.offset,
                hasMore: query.offset + result.data.length < result.total,
            },
        });
    }));
    /**
     * Batched per-rule incident stats for the Alert Rules page (Phase 21):
     * active incident count + last-triggered timestamp, for up to 200 rules in one
     * request so the rules table does not issue N follow-up queries.
     */
    fastify.get('/incidents/rule-stats', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const { ruleIds } = RuleIncidentStatsQuerySchema.parse(request.query ?? {});
        const data = await svc.getRuleIncidentStats(orgId, ruleIds);
        return reply.send({ success: true, data });
    }));
    /** Operational counters for the Alerts overview page. One grouped query. */
    fastify.get('/incidents/summary', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const data = await svc.getSummary(orgId);
        return reply.send({ success: true, data });
    }));
    /**
     * Real-time incident & notification stream (Server-Sent Events / SSE) (Phase 5).
     *
     * HLD Section 8.3 & Phase 5:
     * Eliminates frontend polling by streaming live incident state updates over SSE.
     * Supports Last-Event-ID reconnection handshake and periodic heartbeats.
     */
    fastify.get('/incidents/stream', guard, async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const lastEventId = request.headers['last-event-id'];
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
        reply.raw.flushHeaders?.();
        let isClosed = false;
        const cleanup = () => {
            isClosed = true;
            clearInterval(heartbeat);
        };
        request.raw.on('close', cleanup);
        request.raw.on('end', cleanup);
        // Initial connection frame
        const initialSeq = Date.now();
        reply.raw.write(`id: ${initialSeq}\nevent: connected\ndata: ${JSON.stringify({ connected: true, organizationId: orgId, lastEventId: lastEventId ?? null })}\n\n`);
        // 15-second heartbeat comment to keep HTTP connections alive through proxies / ELBs
        const heartbeat = setInterval(() => {
            if (isClosed)
                return;
            reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
        }, 15_000);
        heartbeat.unref();
    });
    fastify.get('/incidents/:incidentId', guard, withErrorHandling(async (request, reply) => {
        const { orgId, incidentId } = IncidentIdParamsSchema.parse(request.params);
        const data = await svc.getIncident(orgId, incidentId);
        return reply.send({ success: true, data });
    }));
    fastify.get('/incidents/:incidentId/timeline', guard, withErrorHandling(async (request, reply) => {
        const { orgId, incidentId } = IncidentIdParamsSchema.parse(request.params);
        const query = IncidentTimelineQuerySchema.parse(request.query ?? {});
        const result = await svc.getTimeline(orgId, incidentId, query.limit, query.offset);
        return reply.send({
            success: true,
            data: result.data,
            meta: { total: result.total, limit: query.limit, offset: query.offset },
        });
    }));
    fastify.get('/incidents/:incidentId/notifications', guard, withErrorHandling(async (request, reply) => {
        const { orgId, incidentId } = IncidentIdParamsSchema.parse(request.params);
        const query = IncidentTimelineQuerySchema.parse(request.query ?? {});
        const result = await svc.getNotifications(orgId, incidentId, query.limit, query.offset);
        return reply.send({
            success: true,
            data: result.data,
            meta: { total: result.total, limit: query.limit, offset: query.offset },
        });
    }));
    /**
     * Acknowledge. Returns 409 when the incident exists but the transition is
     * illegal from its current state, and 404 when it does not exist in this
     * tenant - so a cross-tenant probe cannot distinguish "exists elsewhere".
     */
    fastify.post('/incidents/:incidentId/acknowledge', guard, withErrorHandling(async (request, reply) => {
        const { orgId, incidentId } = IncidentIdParamsSchema.parse(request.params);
        const data = await svc.acknowledgeIncident(orgId, incidentId, buildMeta(request));
        return reply.send({ success: true, data });
    }));
    fastify.post('/incidents/:incidentId/resolve', guard, withErrorHandling(async (request, reply) => {
        const { orgId, incidentId } = IncidentIdParamsSchema.parse(request.params);
        const body = ResolveIncidentBodySchema.parse(request.body ?? {});
        const data = await svc.resolveIncident(orgId, incidentId, buildMeta(request), body.reason);
        return reply.send({ success: true, data });
    }));
    fastify.post('/incidents/:incidentId/assign', guard, withErrorHandling(async (request, reply) => {
        const { orgId, incidentId } = IncidentIdParamsSchema.parse(request.params);
        const body = AssignIncidentBodySchema.parse(request.body);
        const data = await svc.assignIncident(orgId, incidentId, body.assigneeUserId);
        return reply.send({ success: true, data });
    }));
}
//# sourceMappingURL=incidents.routes.js.map