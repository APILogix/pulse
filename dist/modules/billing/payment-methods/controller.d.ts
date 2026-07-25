import type { FastifyReply, FastifyRequest } from 'fastify';
import { PaymentMethodsService } from './service.js';
export declare class PaymentMethodsController {
    private readonly service;
    constructor(service: PaymentMethodsService);
    listPaymentMethods: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    createPaymentMethod: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    setDefaultPaymentMethod: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    deactivatePaymentMethod: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map