/**
 * Generic webhook connector.
 *
 * Posts a normalized JSON envelope to an arbitrary URL with optional custom
 * headers. When a signingSecret is configured, the body is signed with
 * HMAC-SHA256 over `${timestamp}.${body}` and the signature is sent in the
 * `X-Pulse-Signature` header (scheme: `t=<ts>,v1=<hex>`), mirroring common
 * webhook-signing conventions. Receivers verify with constant-time compare.
 */
import { createHmac } from 'crypto';
import type { ZodType } from 'zod';
import { BaseConnector } from '../../shared/base.connector.js';
import { httpRequest, classifyHttpStatus } from '../../shared/http.js';
import {
  WebhookConfigSchema,
  ConnectorDeliveryError,
  type ConnectionTestResult,
  type ConnectorType,
  type DeliveryResult,
  type NotificationPayload,
  type WebhookConfig,
} from '../../types.js';

export class WebhookConnector extends BaseConnector {
  public readonly type: ConnectorType = 'webhook';

  protected get configSchema(): ZodType {
    return WebhookConfigSchema;
  }

  supportsRichFormatting(): boolean { return false; }
  supportsThreading(): boolean { return false; }
  supportsAttachments(): boolean { return false; }

  private envelope(n: NotificationPayload): string {
    return JSON.stringify({
      id: n.correlationId,
      type: n.notificationType,
      severity: n.severity,
      title: n.title,
      body: n.body,
      fields: n.fields ?? [],
      url: n.url ?? null,
      metadata: n.metadata ?? {},
      timestamp: new Date().toISOString(),
    });
  }

  /** Compute the signature header value for a body. Exposed for verification reuse. */
  static signBody(secret: string, body: string, timestampSec: number): string {
    const signature = createHmac('sha256', secret)
      .update(`${timestampSec}.${body}`)
      .digest('hex');
    return `t=${timestampSec},v1=${signature}`;
  }

  protected async deliver(notification: NotificationPayload): Promise<DeliveryResult> {
    const cfg = this.config<WebhookConfig>();
    const body = this.envelope(notification);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Pulse-Event': notification.notificationType,
      'X-Pulse-Correlation-Id': notification.correlationId,
      ...(cfg.headers ?? {}),
    };

    if (cfg.signingSecret) {
      const ts = Math.floor(Date.now() / 1000);
      headers['X-Pulse-Signature'] = WebhookConnector.signBody(cfg.signingSecret, body, ts);
    }

    const start = Date.now();
    const res = await httpRequest(cfg.url, {
      method: cfg.method,
      headers,
      body,
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return { success: true, statusCode: res.status, latencyMs };
    }
    const { retryable, category } = classifyHttpStatus(res.status);
    throw new ConnectorDeliveryError(
      `Webhook returned ${res.status}`,
      category,
      retryable,
      { statusCode: res.status },
    );
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const cfg = this.config<WebhookConfig>();
    const start = Date.now();
    try {
      // A HEAD probe avoids delivering a spurious event during testing. Many
      // endpoints reject HEAD (405) but still prove reachability.
      const res = await httpRequest(cfg.url, { method: 'HEAD', timeoutMs: 5000 });
      const reachable = res.status > 0;
      return {
        success: reachable,
        message: reachable ? `Endpoint reachable (HTTP ${res.status})` : 'Endpoint unreachable',
        latencyMs: Date.now() - start,
        details: { statusCode: res.status },
      };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed',
        latencyMs: Date.now() - start,
      };
    }
  }
}
