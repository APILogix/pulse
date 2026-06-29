import { authenticate } from '../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../shared/middleware/requireorg.js';
import { AppError } from '../../shared/errors/app-error.js';
import { AcknowledgeEventSchema, CreateEscalationPolicySchema, CreateRoutingRuleSchema, CreateRuleSchema, CreateSilenceSchema, CreateTemplateSchema, IngestEventSchema, ListEventsQuerySchema, ListRulesQuerySchema, ListSilencesQuerySchema, MetricsQuerySchema, OrgEventParamsSchema, OrgIdParamsSchema, OrgPolicyParamsSchema, OrgRuleParamsSchema, PaginationSchema, PreviewTemplateSchema, ResolveEventSchema, SilenceFromEventSchema, TestRoutingSchema, TestRuleSchema, UpsertEscalationStepSchema, UpdateRuleSchema, } from './types.js';
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
export async function alertingRoutes(fastify) {
    const svc = fastify.alerting.service;
    const guard = { preHandler: [authenticate, requireOrgAccess] };
    // ═══════════════════ ALERT RULES ═══════════════════
    fastify.post('/rules', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const body = CreateRuleSchema.parse(request.body);
        const data = await svc.createRule(orgId, buildMeta(request), body);
        return reply.code(201).send({ success: true, data });
    }));
    fastify.get('/rules', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = ListRulesQuerySchema.parse(request.query ?? {});
        const result = await svc.listRules(orgId, query);
        return reply.send({ success: true, data: result.data, meta: { total: result.total, limit: query.limit, offset: query.offset } });
    }));
    fastify.get('/rules/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgRuleParamsSchema.parse(request.params);
        return reply.send({ success: true, data: await svc.getRule(orgId, id) });
    }));
    fastify.patch('/rules/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgRuleParamsSchema.parse(request.params);
        const body = UpdateRuleSchema.parse(request.body);
        return reply.send({ success: true, data: await svc.updateRule(orgId, buildMeta(request), id, body) });
    }));
    fastify.delete('/rules/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgRuleParamsSchema.parse(request.params);
        await svc.deleteRule(orgId, buildMeta(request), id);
        return reply.code(204).send();
    }));
    fastify.post('/rules/:id/enable', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgRuleParamsSchema.parse(request.params);
        return reply.send({ success: true, data: await svc.setRuleEnabled(orgId, buildMeta(request), id, true) });
    }));
    fastify.post('/rules/:id/disable', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgRuleParamsSchema.parse(request.params);
        return reply.send({ success: true, data: await svc.setRuleEnabled(orgId, buildMeta(request), id, false) });
    }));
    fastify.post('/rules/:id/test', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgRuleParamsSchema.parse(request.params);
        const body = TestRuleSchema.parse(request.body);
        return reply.send({ success: true, data: await svc.testRule(orgId, id, body) });
    }));
    fastify.post('/rules/:id/clone', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgRuleParamsSchema.parse(request.params);
        return reply.code(201).send({ success: true, data: await svc.cloneRule(orgId, buildMeta(request), id) });
    }));
    // ═══════════════════ ALERT EVENTS ═══════════════════
    // Ingest is the event intake endpoint (events trigger the async batch pipeline).
    fastify.post('/events', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const body = IngestEventSchema.parse(request.body);
        return reply.code(202).send({ success: true, data: await svc.ingestEvent(orgId, body) });
    }));
    fastify.get('/events', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = ListEventsQuerySchema.parse(request.query ?? {});
        const result = await svc.listEvents(orgId, query);
        return reply.send({ success: true, data: result.data, meta: { total: result.total, limit: query.limit, offset: query.offset } });
    }));
    fastify.get('/events/stats', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        return reply.send({ success: true, data: await svc.getStats(orgId) });
    }));
    fastify.get('/events/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgEventParamsSchema.parse(request.params);
        return reply.send({ success: true, data: await svc.getEvent(orgId, id) });
    }));
    fastify.post('/events/:id/acknowledge', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgEventParamsSchema.parse(request.params);
        const body = AcknowledgeEventSchema.parse(request.body ?? {});
        return reply.send({ success: true, data: await svc.acknowledgeEvent(orgId, buildMeta(request), id, body) });
    }));
    fastify.post('/events/:id/resolve', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgEventParamsSchema.parse(request.params);
        const body = ResolveEventSchema.parse(request.body ?? {});
        return reply.send({ success: true, data: await svc.resolveEvent(orgId, buildMeta(request), id, body) });
    }));
    fastify.post('/events/:id/silence', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgEventParamsSchema.parse(request.params);
        const body = SilenceFromEventSchema.parse(request.body ?? {});
        return reply.code(201).send({ success: true, data: await svc.silenceFromEvent(orgId, buildMeta(request), id, body.durationMinutes, body.comment ?? null) });
    }));
    fastify.get('/events/:id/deliveries', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgEventParamsSchema.parse(request.params);
        return reply.send({ success: true, data: await svc.getEventDeliveries(orgId, id) });
    }));
    // ═══════════════════ SILENCES ═══════════════════
    fastify.post('/silences', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const body = CreateSilenceSchema.parse(request.body);
        return reply.code(201).send({ success: true, data: await svc.createSilence(orgId, buildMeta(request), body) });
    }));
    fastify.get('/silences', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = ListSilencesQuerySchema.parse(request.query ?? {});
        const result = await svc.listSilences(orgId, query.active, query.limit, query.offset);
        return reply.send({ success: true, data: result.data, meta: { total: result.total } });
    }));
    fastify.delete('/silences/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgEventParamsSchema.parse(request.params);
        await svc.expireSilence(orgId, buildMeta(request), id);
        return reply.code(204).send();
    }));
    // ═══════════════════ ESCALATION POLICIES ═══════════════════
    fastify.post('/escalation-policies', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const body = CreateEscalationPolicySchema.parse(request.body);
        return reply.code(201).send({ success: true, data: await svc.createEscalationPolicy(orgId, buildMeta(request), body) });
    }));
    fastify.get('/escalation-policies', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = PaginationSchema.parse(request.query ?? {});
        const result = await svc.listEscalationPolicies(orgId, query.limit, query.offset);
        return reply.send({ success: true, data: result.data, meta: { total: result.total } });
    }));
    fastify.get('/escalation-policies/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgPolicyParamsSchema.parse(request.params);
        return reply.send({ success: true, data: await svc.getEscalationPolicy(orgId, id) });
    }));
    fastify.delete('/escalation-policies/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgPolicyParamsSchema.parse(request.params);
        await svc.deleteEscalationPolicy(orgId, buildMeta(request), id);
        return reply.code(204).send();
    }));
    fastify.put('/escalation-policies/:id/steps', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgPolicyParamsSchema.parse(request.params);
        const body = UpsertEscalationStepSchema.parse(request.body);
        return reply.send({ success: true, data: await svc.upsertEscalationStep(orgId, buildMeta(request), id, body) });
    }));
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
    fastify.post('/routing-rules', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const body = CreateRoutingRuleSchema.parse(request.body);
        return reply.code(201).send({ success: true, data: await svc.createRoutingRule(orgId, buildMeta(request), body) });
    }));
    fastify.get('/routing-rules', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        return reply.send({ success: true, data: await svc.listRoutingRules(orgId) });
    }));
    fastify.delete('/routing-rules/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = OrgPolicyParamsSchema.parse(request.params);
        await svc.deleteRoutingRule(orgId, buildMeta(request), id);
        return reply.code(204).send();
    }));
    fastify.post('/routing-rules/test', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const body = TestRoutingSchema.parse(request.body);
        return reply.send({ success: true, data: await svc.testRouting(orgId, body) });
    }));
    // ═══════════════════ METRICS ═══════════════════
    fastify.get('/metrics', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = MetricsQuerySchema.parse(request.query ?? {});
        return reply.send({ success: true, data: await svc.getMetrics(orgId, query) });
    }));
}
//# sourceMappingURL=routes.js.map