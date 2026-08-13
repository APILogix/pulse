import type { FastifyRequest, FastifyReply } from 'fastify';
import { InvoicesService } from './service.js';
export declare class InvoicesController {
    private readonly service;
    constructor(service: InvoicesService);
    private getOrgId;
    listInvoices: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getUpcomingInvoice: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    getInvoice: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    payInvoice: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map