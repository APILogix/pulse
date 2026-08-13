import type { FastifyRequest, FastifyReply } from 'fastify';
import { PaymentsService } from './service.js';
export declare class PaymentsController {
    private readonly service;
    constructor(service: PaymentsService);
    listPayments: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    refundPayment: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map