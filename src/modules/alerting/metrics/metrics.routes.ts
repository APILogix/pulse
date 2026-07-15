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

export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  const svc = fastify.alerting.service;
  const guard = { preHandler: [authenticate, requireOrgAccess] };

  // ═══════════════════ ALERT RULES ═══════════════════
  // ═══════════════════ ALERT EVENTS ═══════════════════
  // Ingest is the event intake endpoint (events trigger the async batch pipeline).
  // ═══════════════════ SILENCES ═══════════════════
  // ═══════════════════ ESCALATION POLICIES ═══════════════════
  // ═══════════════════ TEMPLATES ═══════════════════
  // ═══════════════════ ROUTING RULES ═══════════════════
  // ═══════════════════ METRICS ═══════════════════
  fastify.get('/metrics', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const query = MetricsQuerySchema.parse(request.query ?? {});
    return reply.send({ success: true, data: await svc.getMetrics(orgId, query) });
  }));
}
