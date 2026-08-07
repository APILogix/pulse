/**
 * Observability controller. Thin HTTP adapters: resolve the {@link QueryContext},
 * validate params, delegate to {@link ObservabilityService}, and shape the
 * `{ success, data }` envelope used across the app. No business logic here.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { QueryContext } from './query-engine/index.js';
import type { ObservabilityService } from './service.js';
import type { ObservabilityContextResolver } from './context.js';
import type { ObservabilityReleasesRepository } from './releases.repository.js';
import { AI_INTENT_VALUES } from './ai/context-assembler.js';
import { streamPoll } from './live/sse.js';

const OrgParams = z.object({ orgId: z.string().uuid() });
const ResourceParams = z.object({ orgId: z.string().uuid(), resource: z.string().min(1).max(40) });
const IdParams = ResourceParams.extend({ id: z.string().min(1).max(128) });
const RelatedParams = IdParams.extend({ relation: z.string().min(1).max(40) });
const ScopeQuery = z.object({
  environment: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).optional(),
});
const TimelineQuery = z.object({ interval: z.enum(['minute', 'hour', 'day']).default('hour') });
const AskBody = z.object({
  intent: z.enum(AI_INTENT_VALUES).default('explain'),
  question: z.string().max(2000).optional(),
});

const BulkAnalyzeBody = z.object({
  selectionMode: z.enum(['selected', 'filtered']).optional().default('filtered'),
  selectedIds: z.array(z.string()).optional().default([]),
  selectAll: z.boolean().optional().default(false),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
  search: z.string().optional().default(''),
  timeRange: z.unknown().optional(),
  prompt: z.string().max(2000).optional(),
  intent: z.enum(AI_INTENT_VALUES).optional().default('explain'),
});

const ErrorGroupIdParams = z.object({ orgId: z.string().uuid(), id: z.string().min(1).max(128) });
const UpdateErrorGroupStatusBody = z.object({
  status: z.enum(['open', 'resolved', 'ignored', 'archived', 'OPEN', 'RESOLVED', 'IGNORED', 'ARCHIVED']),
  reason: z.string().max(1000).optional(),
  comment: z.string().max(1000).optional(),
});
const MergeErrorGroupBody = z.object({
  targetGroupId: z.string().uuid(),
});

type AuthedRequest = FastifyRequest & { user: { id: string } };

export class ObservabilityController {
  constructor(
    private readonly service: ObservabilityService,
    private readonly resolver: ObservabilityContextResolver,
    private readonly releasesRepository: ObservabilityReleasesRepository,
  ) {}

  /** Resolve the tenant/permission context for a request. */
  private async context(request: FastifyRequest): Promise<QueryContext> {
    const { orgId } = OrgParams.parse(request.params);
    const userId = (request as AuthedRequest).user.id;
    const scope = ScopeQuery.parse(request.query ?? {});
    return this.resolver.resolve({
      organizationId: orgId,
      userId,
      environment: scope.environment,
    });
  }

  releases = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const ctx = await this.context(request);
    return reply.send(await this.releasesRepository.list(ctx, request.query ?? {}));
  };

  navigation = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    OrgParams.parse(request.params);
    return reply.send({ success: true, data: this.service.getNavigation() });
  };

  resources = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    OrgParams.parse(request.params);
    return reply.send({ success: true, data: { resources: this.service.resourceNames() } });
  };

  facets = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { resource } = ResourceParams.parse(request.params);
    return reply.send({ success: true, data: this.service.facets(resource) });
  };

  list = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { resource } = ResourceParams.parse(request.params);
    const ctx = await this.context(request);
    const result = await this.service.list(resource, ctx, request.query ?? {});
    return reply.send(result);
  };

  summary = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { resource } = ResourceParams.parse(request.params);
    const ctx = await this.context(request);
    return reply.send({ success: true, data: await this.service.summary(resource, ctx, request.query ?? {}) });
  };

  statistics = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { resource } = ResourceParams.parse(request.params);
    const ctx = await this.context(request);
    return reply.send({ success: true, data: await this.service.statistics(resource, ctx, request.query ?? {}) });
  };

  timeline = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { resource } = ResourceParams.parse(request.params);
    const { interval } = TimelineQuery.parse(request.query ?? {});
    const ctx = await this.context(request);
    return reply.send({ success: true, data: await this.service.timeline(resource, ctx, request.query ?? {}, interval) });
  };

  detail = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { resource, id } = IdParams.parse(request.params);
    const ctx = await this.context(request);
    return reply.send({ success: true, data: await this.service.detail(resource, ctx, id) });
  };

  related = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { resource, id, relation } = RelatedParams.parse(request.params);
    const ctx = await this.context(request);
    return reply.send({ success: true, data: await this.service.related(resource, ctx, id, relation) });
  };

  askEvent = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { resource, id } = IdParams.parse(request.params);
    const body = AskBody.parse(request.body ?? {});
    const ctx = await this.context(request);
    return reply.send({ success: true, data: await this.service.askEvent(resource, ctx, id, body.intent, body.question) });
  };

  askList = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { resource } = ResourceParams.parse(request.params);
    const body = AskBody.parse(request.body ?? {});
    const ctx = await this.context(request);
    return reply.send({ success: true, data: await this.service.askList(resource, ctx, request.query ?? {}, body.intent, body.question) });
  };

  analyzeBulk = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { resource } = ResourceParams.parse(request.params);
    const body = BulkAnalyzeBody.parse(request.body ?? {});
    const ctx = await this.context(request);
    return reply.send({ success: true, data: await this.service.analyzeBulk(resource, ctx, body) });
  };

  /** SSE live tail (Phase 13). */
  stream = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { resource } = ResourceParams.parse(request.params);
    const ctx = await this.context(request);
    const rawQuery = request.query ?? {};
    await streamPoll(request, reply, {
      intervalMs: 2500,
      fetchSince: (since) => this.service.pollSince(resource, ctx, rawQuery, since),
    });
  };

  // ── Dedicated Error Groups API Endpoints ─────────────────────────

  errorGroupList = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const ctx = await this.context(request);
    const result = await this.service.list('error-groups', ctx, request.query ?? {});
    return reply.send(result);
  };

  errorGroupSummary = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const ctx = await this.context(request);
    const summary = await this.service.summary('error-groups', ctx, request.query ?? {});
    return reply.send({ success: true, data: summary });
  };

  errorGroupDetail = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { id } = ErrorGroupIdParams.parse(request.params);
    const ctx = await this.context(request);
    const data = await this.service.getErrorGroupFullDetail(ctx, id);
    return reply.send({ success: true, data });
  };

  errorGroupHistory = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { id } = ErrorGroupIdParams.parse(request.params);
    const ctx = await this.context(request);
    const data = await this.service.getErrorGroupHistory(ctx, id);
    return reply.send({ success: true, data });
  };

  errorGroupEvents = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { id } = ErrorGroupIdParams.parse(request.params);
    const ctx = await this.context(request);
    const data = await this.service.getErrorGroupEvents(ctx, id);
    return reply.send({ success: true, data });
  };

  updateErrorGroupStatus = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { id } = ErrorGroupIdParams.parse(request.params);
    const body = UpdateErrorGroupStatusBody.parse(request.body ?? {});
    const ctx = await this.context(request);
    const data = await this.service.updateErrorGroupStatus(ctx, id, body.status, body.comment ?? body.reason);
    return reply.send({ success: true, data });
  };

  mergeErrorGroups = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { id } = ErrorGroupIdParams.parse(request.params);
    const body = MergeErrorGroupBody.parse(request.body ?? {});
    const ctx = await this.context(request);
    const data = await this.service.mergeErrorGroup(ctx, id, body.targetGroupId);
    return reply.send({ success: true, data });
  };
}
