import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../../shared/middleware/requireorg.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { logger } from '../../../config/logger.js';
import { AlertPolicyEngine } from './policy.engine.js';
import type { AlertCandidate } from './types.js';

const ParamsSchema = z.object({ orgId: z.string().uuid() });
const BodySchema = z.object({
  ruleId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  environment: z.string().max(64).nullable().optional(),
  service: z.string().max(255).nullable().optional(),
  endpoint: z.string().max(500).nullable().optional(),
  source: z.string().min(1).max(100),
  observedAt: z.coerce.date().default(() => new Date()),
  values: z.record(z.string(), z.unknown()).default({}),
  labels: z.record(z.string(), z.unknown()).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().positive().default(1),
});

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message } });
  }
  return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
}

export async function policyRoutes(fastify: FastifyInstance): Promise<void> {
  const engine = new AlertPolicyEngine({ logger: logger.child({ component: 'alert-policy-routes' }) });
  fastify.post('/policy/simulate', {
    preHandler: [authenticate, requireOrgAccess],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = ParamsSchema.parse(request.params);
      const body = BodySchema.parse(request.body ?? {});
      const candidate: AlertCandidate = {
        organizationId: orgId,
        ruleId: body.ruleId,
        projectId: body.projectId ?? null,
        environment: body.environment ?? null,
        service: body.service ?? null,
        endpoint: body.endpoint ?? null,
        source: body.source,
        observedAt: body.observedAt,
        values: body.values,
        ...(body.labels ? { labels: body.labels } : {}),
        ...(body.evidence ? { evidence: body.evidence } : {}),
      };
      const result = await engine.simulate(candidate, body.version);
      return reply.send({ success: true, data: result });
    } catch (error) {
      request.log.error({ err: error, path: request.url }, 'Alert policy simulation failed');
      return handleError(error, reply);
    }
  });
}
