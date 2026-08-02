import type { FastifyRequest, FastifyReply } from 'fastify';
import { EntitlementsService } from './service.js';
export declare class EntitlementsController {
    private readonly service;
    constructor(service: EntitlementsService);
    private getOrgId;
    getAllEntitlements: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    checkFeatureAccess: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map