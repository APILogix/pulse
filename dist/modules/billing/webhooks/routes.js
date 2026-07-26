import { WebhooksController } from './controller.js';
import { WebhooksService } from './service.js';
import { WebhooksRepository } from './repository.js';
import { authenticate, requireAdmin } from '../../../shared/middleware/auth.js';
export async function webhooksRoutes(fastify, options) {
    const repository = new WebhooksRepository();
    const service = new WebhooksService(repository);
    const controller = new WebhooksController(service);
    // Note: These routes are public. Auth happens inside the controller via signature verification.
    fastify.post('/stripe', { config: { rawBody: true } }, controller.stripeWebhook);
    fastify.post('/razorpay', { config: { rawBody: true } }, controller.razorpayWebhook);
    fastify.get('/events', { preHandler: [authenticate, requireAdmin] }, controller.listEvents);
    fastify.post('/events/:eventId/retry', { preHandler: [authenticate, requireAdmin] }, controller.retryEvent);
}
//# sourceMappingURL=routes.js.map