import { WebhooksService } from './service.js';
import { handleBillingError } from '../shared/errors.js';
import { BillingProvider } from '../shared/types.js';
import { ListWebhookEventsQuerySchema, WebhookEventParamsSchema, } from './schemas.js';
function rawBodyOf(request) {
    const rawBody = request.rawBody;
    if (typeof rawBody === 'string')
        return rawBody;
    if (Buffer.isBuffer(rawBody))
        return rawBody.toString('utf8');
    return JSON.stringify(request.body ?? {});
}
export class WebhooksController {
    service;
    constructor(service) {
        this.service = service;
    }
    stripeWebhook = async (request, reply) => {
        const req = request;
        try {
            const payload = req.body;
            const signature = request.headers['stripe-signature'];
            await this.service.processWebhook(BillingProvider.STRIPE, payload, signature, process.env.STRIPE_WEBHOOK_SECRET, rawBodyOf(request), request.id);
            return reply.send({ received: true });
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    razorpayWebhook = async (request, reply) => {
        const req = request;
        try {
            const payload = req.body;
            const signature = request.headers['x-razorpay-signature'];
            await this.service.processWebhook(BillingProvider.RAZORPAY, payload, signature, process.env.RAZORPAY_WEBHOOK_SECRET, rawBodyOf(request), request.id);
            return reply.send({ received: true });
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    listEvents = async (request, reply) => {
        try {
            const query = ListWebhookEventsQuerySchema.parse(request.query);
            const result = await this.service.listWebhookEvents({
                ...(query.provider ? { provider: query.provider } : {}),
                ...(query.status ? { status: query.status } : {}),
                page: query.page,
                limit: query.limit,
            });
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    retryEvent = async (request, reply) => {
        try {
            const { eventId } = WebhookEventParamsSchema.parse(request.params);
            const result = await this.service.retryWebhookEvent(eventId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map