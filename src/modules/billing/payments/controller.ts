import type { FastifyRequest, FastifyReply } from 'fastify';
import { PaymentsService } from './service.js';
import { ListPaymentsQuerySchema, type ListPaymentsQuery } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';

export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  listPayments = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const query = ListPaymentsQuerySchema.parse(req.query) as ListPaymentsQuery;
      const result = await this.service.listPayments(orgId, query.page, query.limit, query.status);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
