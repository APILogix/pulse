import { authenticate } from '../../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../../shared/middleware/requireorg.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { AcknowledgeEventSchema, CreateEscalationPolicySchema, CreateRoutingRuleSchema, CreateRuleSchema, CreateSilenceSchema, CreateTemplateSchema, IngestEventSchema, ListEventsQuerySchema, ListRulesQuerySchema, ListSilencesQuerySchema, MetricsQuerySchema, OrgEventParamsSchema, OrgIdParamsSchema, OrgPolicyParamsSchema, OrgRuleParamsSchema, PaginationSchema, PreviewTemplateSchema, ResolveEventSchema, SilenceFromEventSchema, TestRoutingSchema, TestRuleSchema, UpsertEscalationStepSchema, UpdateRuleSchema, } from '../types.js';
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
    console.log('[alerting.handleError]', error);
    if (error instanceof AppError) {
        return reply.code(error.statusCode).send({
            success: false,
            error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        });
    }
    return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected alerting error' } });
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
export async function templatesRoutes(fastify) {
    const svc = fastify.alerting.service;
    const guard = { preHandler: [authenticate, requireOrgAccess] };
    // ═══════════════════ ALERT RULES ═══════════════════
    // ═══════════════════ ALERT EVENTS ═══════════════════
    // Ingest is the event intake endpoint (events trigger the async batch pipeline).
    // ═══════════════════ SILENCES ═══════════════════
    // ═══════════════════ ESCALATION POLICIES ═══════════════════
    // ═══════════════════ TEMPLATES ═══════════════════
    fastify.post('/templates', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const body = CreateTemplateSchema.parse(request.body);
        return reply.code(201).send({ success: true, data: await svc.createTemplate(orgId, buildMeta(request), body) });
    }));
    fastify.get('/templates', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = PaginationSchema.parse(request.query ?? {});
        const result = await svc.listTemplates(orgId, query.limit, query.offset);
        return reply.send({ success: true, data: result.data, meta: { total: result.total } });
    }));
    fastify.delete('/templates/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgPolicyParamsSchema.parse(request.params);
        await svc.deleteTemplate(orgId, buildMeta(request), id);
        return reply.code(204).send();
    }));
    fastify.post('/templates/:id/preview', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgPolicyParamsSchema.parse(request.params);
        const body = PreviewTemplateSchema.parse(request.body ?? {});
        return reply.send({ success: true, data: await svc.previewTemplate(orgId, id, body.sampleData) });
    }));
    // ═══════════════════ ROUTING RULES ═══════════════════
    // ═══════════════════ METRICS ═══════════════════
}
//# sourceMappingURL=templates.routes.js.map