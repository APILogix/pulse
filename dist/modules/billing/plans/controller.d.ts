import type { FastifyRequest, FastifyReply } from 'fastify';
import { PlansService } from './service.js';
export declare class PlansController {
    private readonly service;
    constructor(service: PlansService);
    listPlans: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    listPublicPlans: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getPlan: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    comparePlans: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    estimatePricing: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map