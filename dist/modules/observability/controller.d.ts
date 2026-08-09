/**
 * Observability controller. Thin HTTP adapters: resolve the {@link QueryContext},
 * validate params, delegate to {@link ObservabilityService}, and shape the
 * `{ success, data }` envelope used across the app. No business logic here.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ObservabilityService } from './service.js';
import type { ObservabilityContextResolver } from './context.js';
import type { ObservabilityReleasesRepository } from './releases.repository.js';
export declare class ObservabilityController {
    private readonly service;
    private readonly resolver;
    private readonly releasesRepository;
    constructor(service: ObservabilityService, resolver: ObservabilityContextResolver, releasesRepository: ObservabilityReleasesRepository);
    /** Resolve the tenant/permission context for a request. */
    private context;
    releases: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    navigation: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    resources: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    facets: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    list: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    summary: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    statistics: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    timeline: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    detail: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    developerTools: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    related: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    askEvent: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    askList: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    analyzeBulk: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    /** SSE live tail (Phase 13). */
    stream: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    errorGroupList: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    errorGroupSummary: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    errorGroupDetail: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    errorGroupHistory: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    errorGroupEvents: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    updateErrorGroupStatus: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    mergeErrorGroups: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    unmergeErrorGroup: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
}
//# sourceMappingURL=controller.d.ts.map