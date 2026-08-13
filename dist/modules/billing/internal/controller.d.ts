import type { FastifyReply, FastifyRequest } from 'fastify';
import { InternalBillingService } from './service.js';
export declare class InternalBillingController {
    private readonly service;
    constructor(service: InternalBillingService);
    getEntitlements: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getFeature: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getLimit: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    consumeEvents: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    consumeEventsBulk: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    consumeAiCredits: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    consumeAiCreditsBulk: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    incrementResource: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    decrementResource: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getEventQuota: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getAiCreditQuota: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    checkQuota: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    syncSubscription: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getSubscriptionStatus: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    generateInvoice: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    finalizeInvoice: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    reconcilePayments: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    validateCoupon: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    redeemCoupon: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map