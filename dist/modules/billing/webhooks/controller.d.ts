import type { FastifyRequest, FastifyReply } from 'fastify';
import { WebhooksService } from './service.js';
export declare class WebhooksController {
    private readonly service;
    constructor(service: WebhooksService);
    stripeWebhook: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    razorpayWebhook: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    listEvents: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    retryEvent: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map