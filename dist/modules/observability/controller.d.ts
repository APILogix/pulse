/**
 * Observability controller. Thin HTTP adapters: resolve the {@link QueryContext},
 * validate params, delegate to {@link ObservabilityService}, and shape the
 * `{ success, data }` envelope used across the app. No business logic here.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ObservabilityService } from './service.js';
import type { ObservabilityContextResolver } from './context.js';
export declare class ObservabilityController {
    private readonly service;
    private readonly resolver;
    constructor(service: ObservabilityService, resolver: ObservabilityContextResolver);
    /** Resolve the tenant/permission context for a request. */
    private context;
    navigation: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    resources: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    facets: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    list: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    summary: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    statistics: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    timeline: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    detail: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    related: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    askEvent: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    askList: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
    /** SSE live tail (Phase 13). */
    stream: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}
//# sourceMappingURL=controller.d.ts.map