import { BillingError, BillingErrorCodes, handleBillingError } from '../shared/errors.js';
import { CheckoutSessionSchema, CreditNoteSchema, TaxProfileSchema } from './schemas.js';
function requireOrgId(request) {
    const req = request;
    const orgId = req.user?.currentOrgId || req.user?.orgId;
    if (!orgId)
        throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
    return orgId;
}
function providerNotConfigured(surface, details) {
    throw new BillingError(`${surface} requires a configured billing provider integration`, BillingErrorCodes.PROVIDER_ERROR, 501, { surface, ...(details ?? {}) });
}
export class ProviderSurfacesController {
    createCheckoutSession = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            const body = CheckoutSessionSchema.parse(request.body);
            providerNotConfigured('checkout.sessions', { organizationId: orgId, planId: body.planId });
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    createCustomerPortal = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            providerNotConfigured('customer_portal', { organizationId: orgId });
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    createCreditNote = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            const body = CreditNoteSchema.parse(request.body);
            providerNotConfigured('credit_notes', { organizationId: orgId, invoiceId: body.invoiceId });
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    upsertTaxProfile = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            TaxProfileSchema.parse(request.body);
            providerNotConfigured('tax_profile', { organizationId: orgId });
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map