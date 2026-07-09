import { WebhooksService } from './service.js';
import { handleBillingError } from '../shared/errors.js';
import { BillingProvider } from '../shared/types.js';
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
            // We pass a dummy secret, in reality it's from env.STRIPE_WEBHOOK_SECRET
            await this.service.processWebhook(BillingProvider.STRIPE, payload, signature, 'secret');
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
            // We pass a dummy secret, in reality it's from env.RAZORPAY_WEBHOOK_SECRET
            await this.service.processWebhook(BillingProvider.RAZORPAY, payload, signature, 'secret');
            return reply.send({ received: true });
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map