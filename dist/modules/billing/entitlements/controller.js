import { EntitlementsService } from './service.js';
import { CheckFeatureAccessSchema } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
export class EntitlementsController {
    service;
    constructor(service) {
        this.service = service;
    }
    getOrgId(req, request) {
        const header = request.headers['x-org-id'] || request.headers['X-Org-Id'];
        const headerOrgId = Array.isArray(header) ? header[0] : header;
        return headerOrgId || req.user?.currentOrgId || req.user?.orgId;
    }
    getAllEntitlements = async (request, reply) => {
        const req = request;
        try {
            const orgId = this.getOrgId(req, request);
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const result = await this.service.getAllEntitlements(orgId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    checkFeatureAccess = async (request, reply) => {
        const req = request;
        try {
            const orgId = this.getOrgId(req, request);
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const body = CheckFeatureAccessSchema.parse(req.body);
            const result = await this.service.checkFeatureAccess(orgId, body.featureKey, body.quantity ?? 1);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map