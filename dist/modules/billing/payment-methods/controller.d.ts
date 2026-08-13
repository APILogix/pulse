import type { FastifyReply, FastifyRequest } from 'fastify';
import { PaymentMethodsService } from './service.js';
export declare class PaymentMethodsController {
    private readonly service;
    constructor(service: PaymentMethodsService);
    listPaymentMethods: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    createPaymentMethod: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    setDefaultPaymentMethod: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    deactivatePaymentMethod: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map