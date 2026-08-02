import type { FastifyRequest, FastifyReply } from 'fastify';
import { UsageService } from './service.js';
export declare class UsageController {
    private readonly service;
    constructor(service: UsageService);
    private requestedOrgId;
    private resolveOrgId;
    getCurrentUsage: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getDailyUsage: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    incrementEventUsage: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getProjectAttribution: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getApiKeyAttribution: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map