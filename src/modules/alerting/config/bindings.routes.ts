/**
 * Alert rule binding routes.
 *
 * Architecture: docs/alerting-redesign/08-implementation-plan.md Increment 2 (API)
 *               docs/alerting-redesign/adr/0004-rule-inheritance-model.md
 *
 * Mounted under /organizations/:orgId/alerting, matching the module convention:
 *   GET    /rules/:ruleId/bindings
 *   POST   /rules/:ruleId/bindings
 *   GET    /rules/:ruleId/bindings/:bindingId
 *   PATCH  /rules/:ruleId/bindings/:bindingId
 *   DELETE /rules/:ruleId/bindings/:bindingId
 *   GET    /rules/:ruleId/effective        ← resolved rule + explainable trace
 *   GET    /rules/:ruleId/revisions
 *
 * Every route is organization-scoped and requires `authenticate` + `requireOrgAccess`, and
 * validates input with Zod before touching the service.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from '../../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../../shared/middleware/requireorg.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { logger } from '../../../config/logger.js';
import { PaginationSchema } from '../common.js';
import { AlertRuleBindingsService } from './bindings.service.js';
import {
  BindingIdParamsSchema,
  BindingParamsSchema,
  CreateBindingSchema,
  EffectiveRuleQuerySchema,
  UpdateBindingSchema,
} from './bindings.types.js';

type AuthedRequest = FastifyRequest & { user?: { id?: string } };

function actorId(request: FastifyRequest): string | null {
  return (request as AuthedRequest).user?.id ?? null;
}

function handleError(error: unknown, reply: FastifyReply) {
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
    error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' },
  });
}

function withErrorHandling(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      request.log.error({ err: error, path: request.url }, 'Alert binding route failed');
      return handleError(error, reply);
    }
  };
}

export async function bindingsRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new AlertRuleBindingsService({
    logger: logger.child({ component: 'alerting-bindings-routes' }),
  });
  const guard = { preHandler: [authenticate, requireOrgAccess] };

  // ═══════════════════ BINDINGS ═══════════════════

  fastify.get('/rules/:ruleId/bindings', guard, withErrorHandling(async (request, reply) => {
    const { orgId, ruleId } = BindingParamsSchema.parse(request.params);
    const data = await service.list(orgId, ruleId);
    return reply.send({ success: true, data, meta: { total: data.length } });
  }));

  fastify.post('/rules/:ruleId/bindings', guard, withErrorHandling(async (request, reply) => {
    const { orgId, ruleId } = BindingParamsSchema.parse(request.params);
    const body = CreateBindingSchema.parse(request.body ?? {});
    const data = await service.create(orgId, ruleId, body, actorId(request));
    return reply.code(201).send({ success: true, data });
  }));

  fastify.get('/rules/:ruleId/bindings/:bindingId', guard, withErrorHandling(async (request, reply) => {
    const { orgId, ruleId, bindingId } = BindingIdParamsSchema.parse(request.params);
    return reply.send({ success: true, data: await service.get(orgId, ruleId, bindingId) });
  }));

  fastify.patch('/rules/:ruleId/bindings/:bindingId', guard, withErrorHandling(async (request, reply) => {
    const { orgId, ruleId, bindingId } = BindingIdParamsSchema.parse(request.params);
    const body = UpdateBindingSchema.parse(request.body ?? {});
    const data = await service.update(orgId, ruleId, bindingId, body, actorId(request));
    return reply.send({ success: true, data });
  }));

  fastify.delete('/rules/:ruleId/bindings/:bindingId', guard, withErrorHandling(async (request, reply) => {
    const { orgId, ruleId, bindingId } = BindingIdParamsSchema.parse(request.params);
    await service.remove(orgId, ruleId, bindingId, actorId(request));
    return reply.code(204).send();
  }));

  // ═══════════════════ EFFECTIVE RULE ═══════════════════
  // The debugging surface for inheritance: returns the ONE rule that would execute for a
  // scope, plus the trace naming every binding that contributed.
  fastify.get('/rules/:ruleId/effective', guard, withErrorHandling(async (request, reply) => {
    const { orgId, ruleId } = BindingParamsSchema.parse(request.params);
    const query = EffectiveRuleQuerySchema.parse(request.query ?? {});
    const result = await service.resolveEffective(orgId, ruleId, query);

    return reply.send({
      success: true,
      data: {
        // Echo the scope that was resolved so a caller can confirm what it asked for.
        scope: {
          organizationId: orgId,
          projectId: query.projectId ?? null,
          environment: query.environment ?? null,
          service: query.service ?? null,
          endpoint: query.endpoint ?? null,
        },
        resolvedScopeType: result.rule.resolvedScopeType,
        resolvedScopeLevel: result.rule.resolvedScopeLevel,
        bindingId: result.rule.bindingId,
        enabled: result.rule.enabled,
        severity: result.rule.severity,
        cooldownSeconds: result.rule.cooldownSeconds,
        deduplicationWindowSeconds: result.rule.deduplicationWindowSeconds,
        evaluationIntervalSeconds: result.rule.evaluationIntervalSeconds,
        autoResolveAfterMinutes: result.rule.autoResolveAfterMinutes,
        consecutiveBreaches: result.rule.consecutiveBreaches,
        requestedChannels: result.rule.requestedChannels,
        actionMode: result.rule.actionMode,
        recipientOverrides: result.rule.recipientOverrides,
        escalationPolicyId: result.rule.escalationPolicyId,
        thresholds: result.thresholds,
        conditions: result.rule.conditions,
        appliedBindingIds: result.appliedBindingIds,
        conflict: result.conflict,
        trace: result.rule.trace,
      },
    });
  }));

  // ═══════════════════ REVISIONS ═══════════════════

  fastify.get('/rules/:ruleId/revisions', guard, withErrorHandling(async (request, reply) => {
    const { orgId, ruleId } = BindingParamsSchema.parse(request.params);
    const { limit } = PaginationSchema.parse(request.query ?? {});
    const data = await service.listRevisions(orgId, ruleId, limit);
    return reply.send({ success: true, data, meta: { total: data.length, limit } });
  }));
}
