import type { FastifyRequest, FastifyReply } from 'fastify';
import { SubscriptionsService } from './service.js';
export declare class SubscriptionsController {
    private readonly service;
    constructor(service: SubscriptionsService);
    private getOrgId;
    getSubscription: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getHistory: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    createSubscription: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    changePlan: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    cancelSubscription: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    previewChange: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    scheduledChange: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getSummary: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map