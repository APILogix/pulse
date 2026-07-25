import { WebhooksService } from './service.js';
import { handleBillingError } from '../shared/errors.js';
import { BillingProvider } from '../shared/types.js';
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
}
//# sourceMappingURL=controller.js.map