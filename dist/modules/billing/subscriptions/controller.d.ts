import type { FastifyRequest, FastifyReply } from 'fastify';
import { SubscriptionsService } from './service.js';
export declare class SubscriptionsController {
    private readonly service;
    constructor(service: SubscriptionsService);
    private getOrgId;
    getSubscription: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getHistory: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    createSubscription: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    changePlan: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    cancelSubscription: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    previewChange: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    scheduledChange: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getSummary: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map