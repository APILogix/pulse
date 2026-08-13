import type { FastifyReply, FastifyRequest } from 'fastify';
import { BillingAuditLogsService } from './service.js';
export declare class BillingAuditLogsController {
    private readonly service;
    constructor(service: BillingAuditLogsService);
    listAuditLogs: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map