import { WebhooksRepository } from './repository.js';
import { BillingProvider } from '../shared/types.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
export class WebhooksService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async processWebhook(provider, payload, signature, secret) {
        // In a real implementation, you would verify the signature here using the provider SDK.
        // e.g. stripe.webhooks.constructEvent(payload, signature, secret)
        const isSignatureValid = true; // stub
        if (!isSignatureValid) {
            throw new BillingError('Invalid webhook signature', BillingErrorCodes.UNAUTHORIZED, 401);
        }
        // Extract event ID and type based on provider format
        let eventId = '';
        let eventType = '';
        if (provider === BillingProvider.STRIPE) {
            eventId = payload.id;
            eventType = payload.type;
        }
        else {
            eventId = payload.id || Date.now().toString();
            eventType = payload.event || 'unknown';
        }
        // Save to inbox (Idempotent because of ON CONFLICT DO NOTHING)
        await this.repository.insertWebhookEvent({
            provider,
            provider_event_id: eventId,
            event_type: eventType,
            payload,
            signature_verified: true,
            api_version: payload.api_version
        });
        // The actual processing (upgrade, invoice paid, etc) will be picked up
        // asynchronously by a worker polling `billing_webhook_events`.
        return { success: true };
    }
}
//# sourceMappingURL=service.js.map