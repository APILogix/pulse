import type { FastifyRequest, FastifyReply } from 'fastify';
import { InvoicesService } from './service.js';
import { 
  ListInvoicesQuerySchema, 
  InvoiceParamsSchema, 
  PayInvoiceSchema,
  type ListInvoicesQuery,
  type InvoiceParams,
  type PayInvoiceBody
} from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';

export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  listInvoices = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const query = ListInvoicesQuerySchema.parse(req.query) as ListInvoicesQuery;
      const result = await this.service.listInvoices(orgId, query.page, query.limit, query.status);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  getUpcomingInvoice = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const result = await this.service.getUpcomingInvoice(orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  getInvoice = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const { invoiceId } = InvoiceParamsSchema.parse(req.params) as InvoiceParams;
      const result = await this.service.getInvoice(orgId, invoiceId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  payInvoice = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const { invoiceId } = InvoiceParamsSchema.parse(req.params) as InvoiceParams;
      const body = PayInvoiceSchema.parse(req.body) as PayInvoiceBody;

      const result = await this.service.payInvoice(orgId, invoiceId, body.paymentMethodId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
