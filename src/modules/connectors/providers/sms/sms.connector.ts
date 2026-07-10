/**
 * SMS connector (Twilio).
 *
 * Sends a plain-text SMS via Twilio's Messages REST API using HTTP Basic auth
 * (AccountSid:AuthToken). No SDK dependency — the REST endpoint is a simple
 * form-encoded POST. Long bodies are truncated to a single concatenated SMS
 * budget to avoid surprising per-segment billing.
 */
import type { ZodType } from 'zod';
import { BaseConnector } from '../../shared/base.connector.js';
import { httpRequest, classifyHttpStatus } from '../../shared/http.js';
import {
  SmsConfigSchema,
  ConnectorDeliveryError,
  type ConnectionTestResult,
  type ConnectorType,
  type DeliveryResult,
  type NotificationPayload,
  type SmsConfig,
} from '../../types.js';

const MAX_SMS_CHARS = 480; // ~3 segments; keeps cost bounded.

export class SmsConnector extends BaseConnector {
  public readonly type: ConnectorType = 'sms';

  protected get configSchema(): ZodType {
    return SmsConfigSchema;
  }

  supportsRichFormatting(): boolean { return false; }
  supportsThreading(): boolean { return false; }
  supportsAttachments(): boolean { return false; }

  private renderMessage(n: NotificationPayload): string {
    const text = `[${n.severity.toUpperCase()}] ${n.title}\n${n.body}${n.url ? `\n${n.url}` : ''}`;
    return text.length > MAX_SMS_CHARS ? `${text.slice(0, MAX_SMS_CHARS - 1)}…` : text;
  }

  protected async deliver(notification: NotificationPayload): Promise<DeliveryResult> {
    const cfg = this.config<SmsConfig>();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`;
    const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
    const message = this.renderMessage(notification);

    const start = Date.now();
    const results: Array<{ to: string; ok: boolean; sid?: string; error?: string; status: number }> = [];

    // Twilio sends to one recipient per request; fan out across configured numbers.
    for (const to of cfg.toNumbers) {
      const form = new URLSearchParams({ To: to, From: cfg.fromNumber, Body: message });
      const res = await httpRequest(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      let sid: string | undefined;
      let error: string | undefined;
      try {
        const parsed = JSON.parse(res.body) as { sid?: string; message?: string };
        sid = parsed.sid;
        error = parsed.message;
      } catch { /* ignore */ }
      results.push({ to, ok: res.status >= 200 && res.status < 300, status: res.status, sid: sid ?? '', error: error ?? '' });
    }

    const latencyMs = Date.now() - start;
    const allOk = results.every((r) => r.ok);
    const anyOk = results.some((r) => r.ok);

    if (allOk) {
      return {
        success: true,
        externalMessageId: results.map((r) => r.sid).filter(Boolean).join(','),
        responseBody: JSON.stringify(results),
        latencyMs,
      };
    }

    // If at least one succeeded, treat as a partial success that is not worth
    // retrying wholesale (would double-send to those that succeeded).
    const firstFailed = results.find((r) => !r.ok)!;
    const { retryable, category } = classifyHttpStatus(firstFailed.status);
    throw new ConnectorDeliveryError(
      `Twilio send failed for ${results.filter((r) => !r.ok).length}/${results.length} recipients: ${firstFailed.error}`,
      category,
      retryable && !anyOk,
      { results },
    );
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const cfg = this.config<SmsConfig>();
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}.json`;
    const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64');
    const start = Date.now();
    try {
      const res = await httpRequest(url, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
        timeoutMs: 5000,
      });
      return {
        success: res.ok,
        message: res.ok ? 'Twilio credentials valid' : `Twilio returned ${res.status}`,
        latencyMs: Date.now() - start,
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
