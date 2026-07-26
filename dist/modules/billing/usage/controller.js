import { UsageService } from './service.js';
import { BillingUuidSchema } from '../shared/types.js';
import { GetUsageRecordsSchema, IncrementUsageSchema, UsageAttributionQuerySchema, } from './schemas.js';
import { BillingError, BillingErrorCodes, handleBillingError } from '../shared/errors.js';
export class UsageController {
    service;
    constructor(service) {
        this.service = service;
    }
    requestedOrgId(request) {
        const header = request.headers['x-org-id'];
        const raw = Array.isArray(header) ? header[0] : header;
        if (!raw)
            return undefined;
        const parsed = BillingUuidSchema.safeParse(raw);
        if (!parsed.success) {
            throw new BillingError('Invalid organization header', BillingErrorCodes.UNAUTHORIZED, 400);
        }
        return parsed.data;
    }
    async resolveOrgId(req, request) {
        return this.service.resolveAuthorizedOrgId(req.user, this.requestedOrgId(request));
    }
    getCurrentUsage = async (request, reply) => {
        const req = request;
        try {
            const orgId = await this.resolveOrgId(req, request);
            const result = await this.service.getCurrentUsage(orgId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    getDailyUsage = async (request, reply) => {
        const req = request;
        try {
            const orgId = await this.resolveOrgId(req, request);
            const query = GetUsageRecordsSchema.parse(req.query);
            const startDate = query.startDate ? new Date(query.startDate) : undefined;
            const endDate = query.endDate ? new Date(query.endDate) : undefined;
            const result = await this.service.getDailyUsage(orgId, startDate, endDate);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    incrementEventUsage = async (request, reply) => {
        const req = request;
        try {
            const orgId = await this.resolveOrgId(req, request);
            const body = IncrementUsageSchema.parse(req.body);
            const result = await this.service.incrementEventUsage(orgId, body.count);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    getProjectAttribution = async (request, reply) => {
        const req = request;
        try {
            const orgId = await this.resolveOrgId(req, request);
            const query = UsageAttributionQuerySchema.parse(req.query);
            const options = {
                bucket: query.bucket,
                limit: query.limit,
                offset: (query.page - 1) * query.limit,
            };
            if (query.startDate)
                options.startDate = new Date(query.startDate);
            if (query.endDate)
                options.endDate = new Date(query.endDate);
            if (query.projectId)
                options.projectId = query.projectId;
            const result = await this.service.getProjectAttribution(orgId, options);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    getApiKeyAttribution = async (request, reply) => {
        const req = request;
        try {
            const orgId = await this.resolveOrgId(req, request);
            const query = UsageAttributionQuerySchema.parse(req.query);
            const options = {
                limit: query.limit,
                offset: (query.page - 1) * query.limit,
            };
            if (query.startDate)
                options.startDate = new Date(query.startDate);
            if (query.endDate)
                options.endDate = new Date(query.endDate);
            if (query.projectId)
                options.projectId = query.projectId;
            const result = await this.service.getApiKeyAttribution(orgId, options);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map