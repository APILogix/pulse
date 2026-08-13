import type { FastifyRequest, FastifyReply } from 'fastify';
import { UsageService } from './service.js';
export declare class UsageController {
    private readonly service;
    constructor(service: UsageService);
    private requestedOrgId;
    private resolveOrgId;
    getCurrentUsage: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getQuotaSummary: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getDailyUsage: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    incrementEventUsage: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getProjectAttribution: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getApiKeyAttribution: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map