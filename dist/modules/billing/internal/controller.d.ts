import type { FastifyReply, FastifyRequest } from 'fastify';
import { InternalBillingService } from './service.js';
export declare class InternalBillingController {
    private readonly service;
    constructor(service: InternalBillingService);
    getEntitlements: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getFeature: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getLimit: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    consumeEvents: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    consumeEventsBulk: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    consumeAiCredits: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    consumeAiCreditsBulk: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    incrementResource: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    decrementResource: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getEventQuota: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getAiCreditQuota: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    checkQuota: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    syncSubscription: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getSubscriptionStatus: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    generateInvoice: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    finalizeInvoice: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    reconcilePayments: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    validateCoupon: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    redeemCoupon: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map