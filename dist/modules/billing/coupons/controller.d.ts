import type { FastifyRequest, FastifyReply } from 'fastify';
import { CouponsService } from './service.js';
export declare class CouponsController {
    private readonly service;
    constructor(service: CouponsService);
    private getOrgId;
    validateCoupon: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    applyCoupon: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map