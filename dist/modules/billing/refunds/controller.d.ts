import type { FastifyReply, FastifyRequest } from 'fastify';
import { PaymentsService } from '../payments/service.js';
export declare class RefundsController {
    private readonly paymentsService;
    constructor(paymentsService: PaymentsService);
    createRefund: (request: FastifyRequest, reply: FastifyReply) => Promise<never>;
}
//# sourceMappingURL=controller.d.ts.map