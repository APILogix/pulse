import type { FastifyReply, FastifyRequest } from 'fastify';
import { AddonsService } from './service.js';
export declare class AddonsController {
    private readonly service;
    constructor(service: AddonsService);
    listAddons: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    listSubscriptionAddons: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    subscribeAddon: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
    cancelSubscriptionAddon: (request: FastifyRequest, reply: FastifyReply) => Promise<any>;
}
//# sourceMappingURL=controller.d.ts.map