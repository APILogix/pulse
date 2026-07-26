import { ZodError } from 'zod';
import { BillingError, handleBillingError } from '../shared/errors.js';
import { InternalBillingService } from './service.js';
import { AiCreditUsageBodySchema, BulkAiCreditUsageBodySchema, BulkEventUsageBodySchema, CouponRedeemBodySchema, CouponValidateBodySchema, EventUsageBodySchema, FeatureParamsSchema, InvoiceFinalizeBodySchema, InvoiceGenerateBodySchema, OrgParamsSchema, PaymentReconcileBodySchema, QuotaCheckBodySchema, ResourceUsageBodySchema, } from './schemas.js';
function meta(request) {
    return { requestId: request.id, timestamp: new Date().toISOString() };
}
function sendData(reply, request, data, statusCode = 200) {
    return reply.code(statusCode).send({ success: true, data, meta: meta(request) });
}
function handleError(error, reply, request) {
    if (error instanceof ZodError) {
        return reply.code(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid billing request', details: error.issues },
            meta: meta(request),
        });
    }
    return handleBillingError(error, reply);
}
export class InternalBillingController {
    service;
    constructor(service) {
        this.service = service;
    }
    getEntitlements = async (request, reply) => {
        try {
            const { orgId } = OrgParamsSchema.parse(request.params);
            return sendData(reply, request, await this.service.getEntitlements(orgId));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    getFeature = async (request, reply) => {
        try {
            const { orgId, featureKey } = FeatureParamsSchema.parse(request.params);
            return sendData(reply, request, await this.service.getFeature(orgId, featureKey));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    getLimit = async (request, reply) => {
        try {
            const { orgId, featureKey } = FeatureParamsSchema.parse(request.params);
            return sendData(reply, request, await this.service.getLimit(orgId, featureKey));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    consumeEvents = async (request, reply) => {
        try {
            const body = EventUsageBodySchema.parse(request.body);
            return sendData(reply, request, await this.service.consumeEvents(body), 202);
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    consumeEventsBulk = async (request, reply) => {
        try {
            const body = BulkEventUsageBodySchema.parse(request.body);
            const results = await Promise.all(body.items.map((item) => this.service.consumeEvents({
                ...(item.requestId ? { requestId: item.requestId } : {}),
                organizationId: item.orgId,
                projectId: item.projectId,
                eventType: item.eventType,
                count: item.count,
            })));
            return sendData(reply, request, { results }, 202);
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    consumeAiCredits = async (request, reply) => {
        try {
            const body = AiCreditUsageBodySchema.parse(request.body);
            return sendData(reply, request, await this.service.consumeAiCredits(body), 202);
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    consumeAiCreditsBulk = async (request, reply) => {
        try {
            const body = BulkAiCreditUsageBodySchema.parse(request.body);
            const results = await Promise.all(body.items.map((item) => this.service.consumeAiCredits(item)));
            return sendData(reply, request, { results }, 202);
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    incrementResource = async (request, reply) => {
        try {
            const body = ResourceUsageBodySchema.parse(request.body);
            return sendData(reply, request, await this.service.adjustResource(body, 1), 202);
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    decrementResource = async (request, reply) => {
        try {
            const body = ResourceUsageBodySchema.parse(request.body);
            return sendData(reply, request, await this.service.adjustResource(body, -1), 202);
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    getEventQuota = async (request, reply) => {
        try {
            const { orgId } = OrgParamsSchema.parse(request.params);
            return sendData(reply, request, await this.service.getEventQuota(orgId));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    getAiCreditQuota = async (request, reply) => {
        try {
            const { orgId } = OrgParamsSchema.parse(request.params);
            return sendData(reply, request, await this.service.getAiCreditQuota(orgId));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    checkQuota = async (request, reply) => {
        try {
            const { orgId } = OrgParamsSchema.parse(request.params);
            const body = QuotaCheckBodySchema.parse(request.body);
            return sendData(reply, request, await this.service.checkEventQuota(orgId, body.requestedCount));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    syncSubscription = async (request, reply) => {
        try {
            const { orgId } = OrgParamsSchema.parse(request.params);
            return sendData(reply, request, await this.service.syncSubscription(orgId), 202);
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    getSubscriptionStatus = async (request, reply) => {
        try {
            const { orgId } = OrgParamsSchema.parse(request.params);
            return sendData(reply, request, await this.service.getSubscriptionStatus(orgId));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    generateInvoice = async (request, reply) => {
        try {
            const body = InvoiceGenerateBodySchema.parse(request.body);
            return sendData(reply, request, await this.service.generateInvoice(body), 201);
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    finalizeInvoice = async (request, reply) => {
        try {
            const body = InvoiceFinalizeBodySchema.parse(request.body);
            return sendData(reply, request, await this.service.finalizeInvoice(body));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    reconcilePayments = async (request, reply) => {
        try {
            const body = PaymentReconcileBodySchema.parse(request.body);
            return sendData(reply, request, await this.service.reconcilePayments(body), 202);
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    validateCoupon = async (request, reply) => {
        try {
            const body = CouponValidateBodySchema.parse(request.body);
            return sendData(reply, request, await this.service.validateCoupon(body));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    };
    redeemCoupon = async (request, reply) => {
        try {
            const body = CouponRedeemBodySchema.parse(request.body);
            return sendData(reply, request, await this.service.redeemCoupon(body), 201);
        }
        catch (error) {
            if (error instanceof BillingError)
                return handleBillingError(error, reply);
            return handleError(error, reply, request);
        }
    };
}
//# sourceMappingURL=controller.js.map