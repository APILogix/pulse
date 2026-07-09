import { InvoicesService } from './service.js';
import { ListInvoicesQuerySchema, InvoiceParamsSchema, PayInvoiceSchema } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
export class InvoicesController {
    service;
    constructor(service) {
        this.service = service;
    }
    listInvoices = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const query = ListInvoicesQuerySchema.parse(req.query);
            const result = await this.service.listInvoices(orgId, query.page, query.limit, query.status);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    getUpcomingInvoice = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const result = await this.service.getUpcomingInvoice(orgId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    getInvoice = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const { invoiceId } = InvoiceParamsSchema.parse(req.params);
            const result = await this.service.getInvoice(orgId, invoiceId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    payInvoice = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const { invoiceId } = InvoiceParamsSchema.parse(req.params);
            const body = PayInvoiceSchema.parse(req.body);
            const result = await this.service.payInvoice(orgId, invoiceId, body.paymentMethodId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map