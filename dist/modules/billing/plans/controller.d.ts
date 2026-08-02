import type { FastifyRequest, FastifyReply } from 'fastify';
import { PlansService } from './service.js';
export declare class PlansController {
    private readonly service;
    constructor(service: PlansService);
    listPlans: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    listPublicPlans: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getPlan: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    comparePlans: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    estimatePricing: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map