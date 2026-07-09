import type { FastifyRequest, FastifyReply } from 'fastify';
import { InvoicesService } from './service.js';
export declare class InvoicesController {
    private readonly service;
    constructor(service: InvoicesService);
    listInvoices: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getUpcomingInvoice: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    getInvoice: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    payInvoice: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map