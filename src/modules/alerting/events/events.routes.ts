/**
 * Alerting route registration.
 *
 * All routes are organization-scoped and require `authenticate` +
 * `requireOrgAccess`. Handlers validate input with Zod, delegate to the
 * service, and map domain errors via `withErrorHandling`.
 *
 * Mounted under /organizations/:orgId/alerting (matches the codebase's
 * org-scoped module convention; see note in docs).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from '../../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../../shared/middleware/requireorg.js';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  AcknowledgeEventSchema,
  CreateEscalationPolicySchema,
  CreateRoutingRuleSchema,
  CreateRuleSchema,
  CreateSilenceSchema,
  CreateTemplateSchema,
  IngestEventSchema,
  ListDeadLettersQuerySchema,
  ListEventsQuerySchema,
  ListRulesQuerySchema,
  ListSilencesQuerySchema,
  MetricsQuerySchema,
  OrgEventParamsSchema,
  OrgIdParamsSchema,
  OrgPolicyParamsSchema,
  OrgRuleParamsSchema,
  PaginationSchema,
  PreviewTemplateSchema,
  ResolveEventSchema,
  SilenceFromEventSchema,
  TestRoutingSchema,
  TestRuleSchema,
  UpsertEscalationStepSchema,
  UpdateRuleSchema,
  type RequestMeta,
} from '../types.js';

type AuthedRequest = FastifyRequest & { user: { id: string } };

function buildMeta(request: FastifyRequest): RequestMeta {
  const ua = request.headers['user-agent'];
  return {
    actorUserId: (request as AuthedRequest).user.id,
    actorIp: request.ip ?? '0.0.0.0',
    actorUserAgent: typeof ua === 'string' ? ua : null,
    requestId: request.id,
  };
}

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({
      success: false,
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
  }
  return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected alerting error' } });
}

function withErrorHandling(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      request.log.error({ err: error, path: request.url }, 'Alerting route failed');
      return handleError(error, reply);
    }
  };
}

export async function eventsRoutes(fastify: FastifyInstance): Promise<void> {
  const svc = fastify.alerting.service;
  const guard = { preHandler: [authenticate, requireOrgAccess] };

  // ═══════════════════ ALERT RULES ═══════════════════
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

  // ═══════════════════ DEAD-LETTER QUEUE (ADMIN) ═══════════════════
  // Failed batch jobs land here after pg-boss retries are exhausted. Operators
  // can inspect them, manually re-drive a still-processing batch, or discard
  // entries whose events were already recovered by the orphan sweeper.
  fastify.get('/dead-letters', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const query = ListDeadLettersQuerySchema.parse(request.query ?? {});
    const result = await svc.listDeadLetters(orgId, query);
    return reply.send({ success: true, data: result.data, meta: { total: result.total, limit: query.limit, offset: query.offset } });
  }));

  fastify.post('/dead-letters/:id/retry', guard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = OrgEventParamsSchema.parse(request.params);
    return reply.send({ success: true, data: await svc.retryDeadLetter(orgId, buildMeta(request), id) });
  }));

  fastify.delete('/dead-letters/:id', guard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = OrgEventParamsSchema.parse(request.params);
    await svc.discardDeadLetter(orgId, buildMeta(request), id);
    return reply.send({ success: true });
  }));

  // ═══════════════════ SILENCES ═══════════════════
  // ═══════════════════ ESCALATION POLICIES ═══════════════════
  // ═══════════════════ TEMPLATES ═══════════════════
  // ═══════════════════ ROUTING RULES ═══════════════════
  // ═══════════════════ METRICS ═══════════════════
}
