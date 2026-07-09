import type { FastifyRequest, FastifyReply } from 'fastify';
import { WebhooksService } from './service.js';
export declare class WebhooksController {
    private readonly service;
    constructor(service: WebhooksService);
    stripeWebhook: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    razorpayWebhook: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map