import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { WebhooksService } from '../../src/modules/billing/webhooks/service.js';
import { BillingProvider } from '../../src/modules/billing/shared/types.js';
import { BillingError } from '../../src/modules/billing/shared/errors.js';
import type { WebhooksRepository } from '../../src/modules/billing/webhooks/repository.js';

describe('WebhooksService Security & Idempotency', () => {
  let mockRepo: WebhooksRepository;
  let service: WebhooksService;
  const webhookSecret = 'whsec_test_secret_key_12345';

  beforeEach(() => {
    mockRepo = {
      insertWebhookEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      listWebhookEvents: vi.fn(),
      markWebhookEventForRetry: vi.fn(),
    } as unknown as WebhooksRepository;

    service = new WebhooksService(mockRepo);
  });

  describe('Stripe Webhook Signature Verification', () => {
    it('successfully validates a valid Stripe signature', async () => {
      const payload = {
        id: 'evt_stripe_123',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            metadata: { organization_id: 'org-test-uuid' },
          },
        },
      };
      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');
      const signatureHeader = `t=${timestamp},v1=${signature}`;

      const res = await service.processWebhook(
        BillingProvider.STRIPE,
        payload,
        signatureHeader,
        webhookSecret,
        rawBody
      );

      expect(res.success).toBe(true);
      expect(mockRepo.insertWebhookEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: BillingProvider.STRIPE,
          provider_event_id: 'evt_stripe_123',
          event_type: 'customer.subscription.updated',
          organization_id: 'org-test-uuid',
          signature_verified: true,
        })
      );
    });

    it('rejects an invalid Stripe signature with 401', async () => {
      const payload = { id: 'evt_123', type: 'invoice.paid' };
      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const invalidHeader = `t=${timestamp},v1=badhexsignature1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`;

      await expect(
        service.processWebhook(
          BillingProvider.STRIPE,
          payload,
          invalidHeader,
          webhookSecret,
          rawBody
        )
      ).rejects.toThrow(BillingError);
    });

    it('rejects expired Stripe webhook beyond tolerance window (300s)', async () => {
      const payload = { id: 'evt_old_123', type: 'invoice.paid' };
      const rawBody = JSON.stringify(payload);
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s old
      const signature = createHmac('sha256', webhookSecret)
        .update(`${oldTimestamp}.${rawBody}`)
        .digest('hex');
      const signatureHeader = `t=${oldTimestamp},v1=${signature}`;

      await expect(
        service.processWebhook(
          BillingProvider.STRIPE,
          payload,
          signatureHeader,
          webhookSecret,
          rawBody
        )
      ).rejects.toThrow(BillingError);
    });
  });

  describe('Razorpay Webhook Signature Verification', () => {
    it('successfully validates a valid Razorpay signature', async () => {
      const payload = {
        event: 'subscription.charged',
        payload: {
          subscription: {
            entity: {
              id: 'sub_rzp_123',
              notes: { organization_id: 'org-rzp-uuid' },
            },
          },
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      const res = await service.processWebhook(
        BillingProvider.RAZORPAY,
        payload,
        signature,
        webhookSecret,
        rawBody
      );

      expect(res.success).toBe(true);
      expect(mockRepo.insertWebhookEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: BillingProvider.RAZORPAY,
          provider_event_id: 'sub_rzp_123',
          event_type: 'subscription.charged',
          organization_id: 'org-rzp-uuid',
        })
      );
    });
  });
});
