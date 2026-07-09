import type { FastifyRequest, FastifyReply } from 'fastify';
import { AiBillingService } from './service.js';
export declare class AiBillingController {
    private readonly service;
    constructor(service: AiBillingService);
    consumeAiCredits: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map