import { WebhooksRepository } from './repository.js';
import { BillingProvider } from '../shared/types.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { createHmac, createHash, timingSafeEqual } from 'crypto';

const WEBHOOK_TOLERANCE_SECONDS = 300;

function safeEqualHex(expected: string, actual: string): boolean {
  if (!expected || !actual) return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function verifyStripeSignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    }),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || !signature) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return safeEqualHex(expected, signature);
}

function verifyRazorpaySignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signatureHeader);
}

function extractOrganizationId(payload: any): string | null {
  return (
    payload?.organization_id ??
    payload?.organizationId ??
    payload?.data?.object?.metadata?.organization_id ??
    payload?.data?.object?.metadata?.organizationId ??
    payload?.payload?.subscription?.entity?.notes?.organization_id ??
    payload?.payload?.payment?.entity?.notes?.organization_id ??
    null
  );
}

function maybeUuid(value: string | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export class WebhooksService {
  constructor(private readonly repository: WebhooksRepository) {}

  async processWebhook(
    provider: BillingProvider,
    payload: any,
    signature: string | undefined,
    secret: string | undefined,
    rawBody: string,
    requestId?: string,
  ) {
    const isSignatureValid =
      provider === BillingProvider.STRIPE
        ? verifyStripeSignature(rawBody, signature, secret ?? '')
        : verifyRazorpaySignature(rawBody, signature, secret ?? '');

    if (!isSignatureValid) {
      throw new BillingError('Invalid webhook signature', BillingErrorCodes.UNAUTHORIZED, 401);
    }

    // Extract event ID and type based on provider format
    let eventId = '';
    let eventType = '';
    
    if (provider === BillingProvider.STRIPE) {
      eventId = payload.id;
      eventType = payload.type;
    } else {
      eventId = payload.id || payload.event_id || payload.payload?.payment?.entity?.id || payload.payload?.subscription?.entity?.id;
      eventType = payload.event || 'unknown';
    }

    if (!eventId || !eventType) {
      throw new BillingError('Webhook payload is missing a stable event id or type', BillingErrorCodes.PROVIDER_ERROR, 400);
    }

    await this.repository.insertWebhookEvent({
      provider,
      provider_event_id: eventId,
      event_type: eventType,
      organization_id: extractOrganizationId(payload),
      payload,
      payload_sha256: createHash('sha256').update(rawBody).digest('hex'),
      signature_verified: true,
      api_version: payload.api_version,
      request_id: maybeUuid(requestId),
    });

    return { success: true };
  }

  async listWebhookEvents(options: { provider?: BillingProvider; status?: string; page: number; limit: number }) {
    const offset = (options.page - 1) * options.limit;
    const { data, total } = await this.repository.listWebhookEvents({
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.status ? { status: options.status } : {}),
      limit: options.limit,
      offset,
    });

    return {
      success: true,
      data,
      meta: {
        page: options.page,
        limit: options.limit,
        total,
        hasMore: offset + data.length < total,
      },
    };
  }

  async retryWebhookEvent(eventId: string) {
    const event = await this.repository.markWebhookEventForRetry(eventId);
    if (!event) {
      throw new BillingError('Webhook event is not retryable', BillingErrorCodes.PROVIDER_ERROR, 400);
    }
    return { success: true, data: event };
  }
}
