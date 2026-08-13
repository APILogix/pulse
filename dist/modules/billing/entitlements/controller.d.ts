import type { FastifyRequest, FastifyReply } from 'fastify';
import { EntitlementsService } from './service.js';
export declare class EntitlementsController {
    private readonly service;
    constructor(service: EntitlementsService);
    private getOrgId;
    getAllEntitlements: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    checkFeatureAccess: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map