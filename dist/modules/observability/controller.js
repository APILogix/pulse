import { z } from 'zod';
import { AI_INTENT_VALUES } from './ai/context-assembler.js';
import { streamPoll } from './live/sse.js';
const OrgParams = z.object({ orgId: z.string().uuid() });
const ResourceParams = z.object({ orgId: z.string().uuid(), resource: z.string().min(1).max(40) });
const IdParams = ResourceParams.extend({ id: z.string().min(1).max(128) });
const RelatedParams = IdParams.extend({ relation: z.string().min(1).max(40) });
const ScopeQuery = z.object({
    projectId: z.string().uuid().optional(),
    environment: z.string().trim().min(1).max(64).optional(),
});
const TimelineQuery = z.object({ interval: z.enum(['minute', 'hour', 'day']).default('hour') });
const AskBody = z.object({
    intent: z.enum(AI_INTENT_VALUES).default('explain'),
    question: z.string().max(2000).optional(),
});
export class ObservabilityController {
    service;
    resolver;
    constructor(service, resolver) {
        this.service = service;
        this.resolver = resolver;
    }
    /** Resolve the tenant/permission context for a request. */
    async context(request) {
        const { orgId } = OrgParams.parse(request.params);
        const userId = request.user.id;
        const scope = ScopeQuery.parse(request.query ?? {});
        return this.resolver.resolve({
            organizationId: orgId,
            userId,
            projectId: scope.projectId,
            environment: scope.environment,
        });
    }
    navigation = async (request, reply) => {
        OrgParams.parse(request.params);
        return reply.send({ success: true, data: this.service.getNavigation() });
    };
    resources = async (request, reply) => {
        OrgParams.parse(request.params);
        return reply.send({ success: true, data: { resources: this.service.resourceNames() } });
    };
    facets = async (request, reply) => {
        const { resource } = ResourceParams.parse(request.params);
        return reply.send({ success: true, data: this.service.facets(resource) });
    };
    list = async (request, reply) => {
        const { resource } = ResourceParams.parse(request.params);
        const ctx = await this.context(request);
        const result = await this.service.list(resource, ctx, request.query ?? {});
        return reply.send(result);
    };
    summary = async (request, reply) => {
        const { resource } = ResourceParams.parse(request.params);
        const ctx = await this.context(request);
        return reply.send({ success: true, data: await this.service.summary(resource, ctx, request.query ?? {}) });
    };
    statistics = async (request, reply) => {
        const { resource } = ResourceParams.parse(request.params);
        const ctx = await this.context(request);
        return reply.send({ success: true, data: await this.service.statistics(resource, ctx, request.query ?? {}) });
    };
    timeline = async (request, reply) => {
        const { resource } = ResourceParams.parse(request.params);
        const { interval } = TimelineQuery.parse(request.query ?? {});
        const ctx = await this.context(request);
        return reply.send({ success: true, data: await this.service.timeline(resource, ctx, request.query ?? {}, interval) });
    };
    detail = async (request, reply) => {
        const { resource, id } = IdParams.parse(request.params);
        const ctx = await this.context(request);
        return reply.send({ success: true, data: await this.service.detail(resource, ctx, id) });
    };
    related = async (request, reply) => {
        const { resource, id, relation } = RelatedParams.parse(request.params);
        const ctx = await this.context(request);
        return reply.send({ success: true, data: await this.service.related(resource, ctx, id, relation) });
    };
    askEvent = async (request, reply) => {
        const { resource, id } = IdParams.parse(request.params);
        const body = AskBody.parse(request.body ?? {});
        const ctx = await this.context(request);
        return reply.send({ success: true, data: await this.service.askEvent(resource, ctx, id, body.intent, body.question) });
    };
    askList = async (request, reply) => {
        const { resource } = ResourceParams.parse(request.params);
        const body = AskBody.parse(request.body ?? {});
        const ctx = await this.context(request);
        return reply.send({ success: true, data: await this.service.askList(resource, ctx, request.query ?? {}, body.intent, body.question) });
    };
    /** SSE live tail (Phase 13). */
    stream = async (request, reply) => {
        const { resource } = ResourceParams.parse(request.params);
        const ctx = await this.context(request);
        const rawQuery = request.query ?? {};
        await streamPoll(request, reply, {
            intervalMs: 2500,
            fetchSince: (since) => this.service.pollSince(resource, ctx, rawQuery, since),
        });
    };
}
//# sourceMappingURL=controller.js.map