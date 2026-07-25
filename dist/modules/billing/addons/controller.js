import { BillingError, BillingErrorCodes, handleBillingError } from '../shared/errors.js';
import { AddonsService } from './service.js';
import { ListAddonsQuerySchema, SubscribeAddonSchema, SubscriptionAddonParamsSchema } from './schemas.js';
function requireOrgId(request) {
    const req = request;
    const orgId = req.user?.currentOrgId ?? req.user?.orgId;
    if (!orgId)
        throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
    return orgId;
}
export class AddonsController {
    service;
    constructor(service) {
        this.service = service;
    }
    listAddons = async (request, reply) => {
        try {
            const query = ListAddonsQuerySchema.parse(request.query);
            return reply.send(await this.service.listAddons(query));
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    listSubscriptionAddons = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            return reply.send(await this.service.listSubscriptionAddons(orgId));
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    subscribeAddon = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            const body = SubscribeAddonSchema.parse(request.body);
            return reply.code(201).send(await this.service.subscribeAddon(orgId, body));
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    cancelSubscriptionAddon = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            const { subscriptionAddonId } = SubscriptionAddonParamsSchema.parse(request.params);
            return reply.send(await this.service.cancelSubscriptionAddon(orgId, subscriptionAddonId));
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map