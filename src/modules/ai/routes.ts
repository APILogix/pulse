import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { authenticate } from '../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../shared/middleware/requireorg.js';
import { encrypt } from '../../shared/utils/encryption.js';
import { env } from '../../config/env.js';
import { aiConfig } from '../../config/ai.js';
import { pool } from '../../config/database.js';
import {
  aiRequestInputSchema,
  aiInvestigationRequestSchema,
  type AIMode,
  type AIRequestInput,
} from './types.js';
import type { AnalysisExecution } from './analyzer.js';
import { monitoringChatInputSchema, type ChatExecution } from './chat.js';
import { AIRepositoryError } from './repository.js';
import { enqueueAIJob } from './queue.js';
import { sanitizeUntrusted, sha256 } from './security.js';
import { AI_MODE_ROUTES } from './feature-routes.js';
import { resolveInvestigationContext } from './investigation-context.js';
import { ObservabilityRepository } from '../observability/repository.js';
import { ObservabilityContextResolver } from '../observability/context.js';
import { CorrelationEngine } from '../observability/correlation/engine.js';

const orgParamsSchema = z.object({ orgId: z.string().uuid() });
const jobParamsSchema = orgParamsSchema.extend({ jobId: z.string().uuid() });
const feedbackParamsSchema = orgParamsSchema.extend({ responseId: z.string().uuid() });
const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  helpful: z.boolean().optional(),
  correction: z.string().max(4_000).optional(),
  comment: z.string().max(4_000).optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one feedback field is required');

const aiRouteRequestSchema = aiRequestInputSchema.partial({ ai_mode: true });

function inferMode(input: z.infer<typeof aiRouteRequestSchema>): AIMode {
  const query = input.user_query?.toLowerCase() ?? '';
  if (input.sql_query || /\bsql|query plan|index\b/.test(query)) return 'AI_SQL_OPTIMIZATION';
  if (input.stack_trace || /stack trace/.test(query)) return 'AI_STACK_TRACE_ANALYSIS';
  if (input.trace || /distributed trace|critical path/.test(query)) return 'AI_TRACE_ANALYSIS';
  if (input.spans?.length || /\bspan\b/.test(query)) return 'AI_SPAN_ANALYSIS';
  if (input.deployment_events?.length || /deployment|rollback|release/.test(query)) return 'AI_DEPLOYMENT_CORRELATION';
  if (/weekly|reliability report|trend report/.test(query)) return 'AI_WEEKLY_REPORT';
  if (input.incident_metadata || /incident summary|situation update/.test(query)) return 'AI_INCIDENT_SUMMARY';
  if (input.logs?.length || /summari[sz]e logs|log spike/.test(query)) return 'AI_LOG_SUMMARY';
  if (/root cause|why did.*happen|find the cause/.test(query)) return 'AI_ROOT_CAUSE_ANALYSIS';
  if (/how (?:do|to) (?:i )?fix|remediation|suggested fix/.test(query)) return 'AI_SUGGESTED_FIXES';
  return 'AI_ERROR_EXPLANATION';
}

function parseAIRequest(body: unknown): AIRequestInput {
  const parsed = aiRouteRequestSchema.parse(body);
  return { ...parsed, ai_mode: parsed.ai_mode ?? inferMode(parsed) };
}

function parseFeatureRequest(body: unknown, mode: AIMode): AIRequestInput {
  const parsed = aiRouteRequestSchema.parse(body);
  if (parsed.ai_mode && parsed.ai_mode !== mode) {
    throw new AIRepositoryError(`This endpoint only accepts ${mode}`, 'INVALID_REQUEST');
  }
  return { ...parsed, ai_mode: mode };
}

function idempotencyKey(request: FastifyRequest): string {
  const header = request.headers['idempotency-key'] ?? request.headers['x-idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.length < 8 || value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new AIRepositoryError('A valid Idempotency-Key header is required', 'DUPLICATE_IN_PROGRESS');
  }
  return value;
}



function statusCode(status: string): number {
  if (status === 'LOCKED') return 403;
  if (status === 'INSUFFICIENT_CREDITS') return 402;
  if (status === 'SAFETY_BLOCKED') return 422;
  if (status === 'INVALID_REQUEST') return 400;
  if (status === 'PROVIDER_ERROR' || status === 'FAILED') return 503;
  return 200;
}

function sendError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: 'AI request validation failed', details: error.issues } });
  }
  if (error instanceof AIRepositoryError) {
    const status = error.code === 'LOCKED' ? 403
      : error.code === 'INSUFFICIENT_CREDITS' ? 402
      : error.code === 'TOO_MANY_JOBS' || error.code === 'TOO_MANY_CHAT_REQUESTS' ? 429
      : error.code === 'INVALID_REQUEST' ? 400
      : error.code === 'NOT_FOUND' ? 404 : 409;
    return reply.status(status).send({ error: { code: error.code, message: error.message } });
  }
  throw error;
}

export async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  const pending = new Map<string, AnalysisExecution>();
  const pendingChat = new Map<string, { tenantId: string; execution: ChatExecution }>();

  fastify.addHook('onResponse', async (request) => {
    const chatExecution = pendingChat.get(request.id);
    if (chatExecution) {
      pendingChat.delete(request.id);
      await fastify.ai.chat.confirmUsage({ tenantId: chatExecution.tenantId }, chatExecution.execution).catch((error) => {
        request.log.error({ err: error, requestId: chatExecution.execution.response.request_id }, 'AI chat delivered but usage logging failed');
      });
    }
    const execution = pending.get(request.id);
    if (!execution) return;
    pending.delete(request.id);
    await fastify.ai.analyzer.confirmDelivery(execution).catch((error) => {
      request.log.error({ err: error, requestId: execution.answer.request_id }, 'AI answer delivered but credit finalization failed');
    });
  });
  fastify.addHook('onError', async (request, _reply, error) => {
    pendingChat.delete(request.id);
    const execution = pending.get(request.id);
    if (!execution) return;
    pending.delete(request.id);
    await fastify.ai.analyzer.cancelDelivery(execution, `Response delivery failed: ${error.message}`).catch((releaseError) => {
      request.log.error({ err: releaseError }, 'AI reservation release failed after delivery error');
    });
  });

  const analyzeOptions = {
    preHandler: [authenticate, requireOrgAccess],
  };
  const analyze = (forcedMode?: AIMode) => async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = orgParamsSchema.parse(request.params);
      const userId = request.user!.id;
      const body = forcedMode
        ? parseFeatureRequest(request.body, forcedMode)
        : parseAIRequest(request.body);
      const execution = await fastify.ai.analyzer.analyze(body, {
        tenantId: orgId,
        userId,
        requestId: randomUUID(),
        idempotencyKey: idempotencyKey(request),
      });
      if (execution.reservation || (execution.usage && execution.usageContext && execution.answer.status === 'SUCCESS')) {
        pending.set(request.id, execution);
      }
      return reply.status(statusCode(execution.answer.status)).send(execution.answer);
    } catch (error) {
      return sendError(error, reply);
    }
  };

  // A dedicated endpoint per AI capability keeps authorization, quotas,
  // observability, and future model routing independently controllable.
  for (const [path, mode] of Object.entries(AI_MODE_ROUTES)) {
    fastify.post(path, analyzeOptions, analyze(mode));
  }

  // Backward-compatible auto-routing endpoint. New clients should use the
  // dedicated feature endpoints above.
  fastify.post('/analyze', analyzeOptions, analyze());

  const obsRepo = new ObservabilityRepository();
  const obsResolver = new ObservabilityContextResolver(pool);
  const obsCorrelation = new CorrelationEngine(obsRepo);

  // Canonical minimal investigation endpoint: resolves context from publicId and runs AI analysis
  fastify.post('/investigate', analyzeOptions, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId } = orgParamsSchema.parse(request.params);
      const userId = request.user!.id;
      const { resource, publicId } = aiInvestigationRequestSchema.parse(request.body);

      const { aiInput } = await resolveInvestigationContext(
        orgId,
        userId,
        resource,
        publicId,
        {
          resolver: obsResolver,
          repository: obsRepo,
          correlation: obsCorrelation,
        },
      );

      const execution = await fastify.ai.analyzer.analyze(aiInput, {
        tenantId: orgId,
        userId,
        requestId: randomUUID(),
        idempotencyKey: idempotencyKey(request),
      });

      if (execution.reservation || (execution.usage && execution.usageContext && execution.answer.status === 'SUCCESS')) {
        pending.set(request.id, execution);
      }
      return reply.status(statusCode(execution.answer.status)).send(execution.answer);
    } catch (error) {
      return sendError(error, reply);
    }
  });

  fastify.post('/chat', {
    preHandler: [authenticate, requireOrgAccess],
  }, async (request, reply) => {
    try {
      const { orgId } = orgParamsSchema.parse(request.params);
      const input = monitoringChatInputSchema.parse(request.body);
      const execution = await fastify.ai.chat.chat(input, {
        tenantId: orgId,
        userId: request.user!.id,
        idempotencyKey: idempotencyKey(request),
      });
      if (execution.usagePending) pendingChat.set(request.id, { tenantId: orgId, execution });
      return reply.status(execution.response.status === 'LOCKED' ? 403 : 200).send(execution.response);
    } catch (error) {
      return sendError(error, reply);
    }
  });

  fastify.post('/jobs', {
    preHandler: [authenticate, requireOrgAccess],
  }, async (request, reply) => {
    try {
      const { orgId } = orgParamsSchema.parse(request.params);
      const body = parseAIRequest(request.body);
      if (body.ai_mode !== 'AI_WEEKLY_REPORT' && body.ai_mode !== 'AI_INCIDENT_SUMMARY') {
        return reply.status(400).send({ error: { code: 'INVALID_AI_JOB_MODE', message: 'Only weekly reports and incident summaries support asynchronous jobs.' } });
      }
      const userId = request.user!.id;
      const requestIdempotencyKey = idempotencyKey(request);
      const authorization = await fastify.ai.repository.authorize(orgId, userId, body.ai_mode);
      if (!authorization.entitled) {
        return reply.status(403).send({ error: { code: 'LOCKED', message: 'This AI capability is not included in the current plan.' } });
      }
      const sanitized = sanitizeUntrusted(body, aiConfig.maxInputChars);
      const encryptedInput = encrypt(JSON.stringify(sanitized.value), env.ENCRYPTION_KEY);
      const preparedJob = await fastify.ai.repository.createJob({
        tenantId: orgId, userId, mode: body.ai_mode,
        inputHash: sha256(sanitized.value), encryptedInput,
        idempotencyKey: requestIdempotencyKey,
        maxConcurrentJobs: aiConfig.maxConcurrentJobsPerTenant,
      });
      if (preparedJob.created) {
        try {
          const queueJobId = await enqueueAIJob(preparedJob.jobId);
          await fastify.ai.repository.attachQueueJob(preparedJob.jobId, orgId, queueJobId);
        } catch (error) {
          await fastify.ai.repository.failJob(preparedJob.jobId, 'Queue submission failed');
          throw error;
        }
      }
      return reply.status(202).send({
        success: true,
        data: {
          jobId: preparedJob.jobId,
          status: preparedJob.status,
          idempotentReplay: !preparedJob.created,
          creditsCharged: 0,
        },
      });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  fastify.get('/jobs/:jobId', { preHandler: [authenticate, requireOrgAccess] }, async (request, reply) => {
    try {
      const { orgId, jobId } = jobParamsSchema.parse(request.params);
      const job = await fastify.ai.repository.getJob(orgId, jobId, request.user!.id);
      if (!job) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'AI job not found' } });
      return reply.send({ success: true, data: job });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  fastify.post('/responses/:responseId/feedback', { preHandler: [authenticate, requireOrgAccess] }, async (request, reply) => {
    try {
      const { orgId, responseId } = feedbackParamsSchema.parse(request.params);
      const body = feedbackSchema.parse(request.body);
      const feedbackId = await fastify.ai.repository.saveFeedback({
        tenantId: orgId,
        userId: request.user!.id,
        responseId,
        ...(body.rating !== undefined ? { rating: body.rating } : {}),
        ...(body.helpful !== undefined ? { helpful: body.helpful } : {}),
        ...(body.correction !== undefined ? { correction: body.correction } : {}),
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
      });
      fastify.ai.analyzer.recordFeedback(body.rating, body.helpful, Boolean(body.correction));
      return reply.status(201).send({ success: true, data: { feedbackId } });
    } catch (error) {
      return sendError(error, reply);
    }
  });
}
