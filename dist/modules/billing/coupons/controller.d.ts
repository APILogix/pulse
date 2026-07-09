import type { FastifyRequest, FastifyReply } from 'fastify';
import { CouponsService } from './service.js';
export declare class CouponsController {
    private readonly service;
    constructor(service: CouponsService);
    validateCoupon: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    applyCoupon: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map