import type { FastifyReply, FastifyRequest } from 'fastify';
import { BillingError, BillingErrorCodes, handleBillingError } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';
import { PaymentsService } from '../payments/service.js';
import { CreateRefundSchema, type CreateRefundBody } from './schemas.js';

export class RefundsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  createRefund = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user?.currentOrgId || req.user?.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);

      const body = CreateRefundSchema.parse(request.body) as CreateRefundBody;
      const result = await this.paymentsService.refundPayment(orgId, body.paymentId, body.amount, body.reason);
      return reply.code(201).send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
