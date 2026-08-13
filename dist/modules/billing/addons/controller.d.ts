import type { FastifyReply, FastifyRequest } from 'fastify';
import { AddonsService } from './service.js';
export declare class AddonsController {
    private readonly service;
    constructor(service: AddonsService);
    listAddons: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    listSubscriptionAddons: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    subscribeAddon: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
    cancelSubscriptionAddon: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map