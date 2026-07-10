/**
 * Slack connector — reference implementation.
 *
 * Supports two delivery modes:
 *   1. Incoming webhook (config.webhookUrl) — simplest, no scopes.
 *   2. Bot token (config.botToken + defaultChannel) — chat.postMessage API,
 *      returns a message ts usable for threading.
 *
 * Formatting uses Slack Block Kit. Severity maps to a colored attachment bar.
 */
import type { ZodType } from 'zod';
import { BaseConnector } from '../../shared/base.connector.js';
import { httpRequest, classifyHttpStatus } from '../../shared/http.js';
import {
  SlackConfigSchema,
  ConnectorDeliveryError,
  type ConnectionTestResult,
  type ConnectorType,
  type DeliveryResult,
  type NotificationPayload,
  type SlackConfig,
} from '../../types.js';

const SEVERITY_COLOR: Record<string, string> = {
  info: '#36a64f',
  warning: '#daa038',
  error: '#d64f4f',
  critical: '#a30000',
};

export class SlackConnector extends BaseConnector {
  public readonly type: ConnectorType = 'slack';

  protected get configSchema(): ZodType {
    return SlackConfigSchema;
  }

  supportsRichFormatting(): boolean { return true; }
  supportsThreading(): boolean { return true; }
  supportsAttachments(): boolean { return true; }

  private buildBlocks(n: NotificationPayload): Record<string, unknown> {
    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'header',
        text: { type: 'plain_text', text: this.truncate(n.title, 150), emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: this.truncate(n.body, 3000) },
      },
    ];

    if (n.fields?.length) {
      blocks.push({
        type: 'section',
        fields: n.fields.slice(0, 10).map((f) => ({
          type: 'mrkdwn',
          text: `*${f.label}*\n${f.value}`,
        })),
      });
    }

    if (n.url) {
      blocks.push({
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: 'View details' },
          url: n.url,
        }],
      });
    }

    return {
      attachments: [{
        color: SEVERITY_COLOR[n.severity] ?? SEVERITY_COLOR.info,
        blocks,
      }],
    };
  }

  protected async deliver(notification: NotificationPayload): Promise<DeliveryResult> {
    const cfg = this.config<SlackConfig>();
    const blocks = this.buildBlocks(notification);

    if (cfg.botToken) {
      return this.deliverViaApi(cfg, notification, blocks);
    }
    return this.deliverViaWebhook(cfg.webhookUrl!, blocks);
  }

  private async deliverViaWebhook(
    webhookUrl: string,
    blocks: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    const start = Date.now();
    const res = await httpRequest(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(blocks),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return { success: true, statusCode: res.status, responseBody: res.body, latencyMs };
    }
    const { retryable, category } = classifyHttpStatus(res.status);
    throw new ConnectorDeliveryError(
      `Slack webhook returned ${res.status}: ${res.body.slice(0, 200)}`,
      category,
      retryable,
      { statusCode: res.status },
    );
  }

  private async deliverViaApi(
    cfg: SlackConfig,
    notification: NotificationPayload,
    blocks: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    const start = Date.now();
    const res = await httpRequest('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.botToken}`,
      },
      body: JSON.stringify({
        channel: cfg.defaultChannel,
        ...(notification.threadKey ? { thread_ts: notification.threadKey } : {}),
        ...blocks,
      }),
    });
    const latencyMs = Date.now() - start;

    // Slack API returns 200 with { ok: false, error } on logical failures.
    let parsed: { ok?: boolean; ts?: string; error?: string } = {};
    try { parsed = JSON.parse(res.body); } catch { /* leave empty */ }

    if (res.ok && parsed.ok) {
      return {
        success: true,
        statusCode: res.status,
        externalMessageId: parsed.ts ?? '',
        responseBody: res.body,
        latencyMs,
      };
    }

    if (parsed.error === 'invalid_auth' || parsed.error === 'not_authed' || res.status === 401) {
      throw new ConnectorDeliveryError(`Slack auth failed: ${parsed.error ?? res.status}`, 'auth_error', false);
    }
    if (parsed.error === 'rate_limited' || res.status === 429) {
      throw new ConnectorDeliveryError('Slack rate limited', 'rate_limit', true);
    }
    const { retryable, category } = classifyHttpStatus(res.status);
    throw new ConnectorDeliveryError(
      `Slack API error: ${parsed.error ?? res.body.slice(0, 200)}`,
      category,
      retryable,
    );
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const cfg = this.config<SlackConfig>();
    const start = Date.now();

    try {
      if (cfg.botToken) {
        const res = await httpRequest('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.botToken}` },
        });
        const parsed = JSON.parse(res.body) as { ok?: boolean; team?: string; error?: string };
        return {
          success: Boolean(parsed.ok),
          message: parsed.ok ? `Authenticated to ${parsed.team}` : `Auth failed: ${parsed.error}`,
          latencyMs: Date.now() - start,
        };
      }
      // Webhook mode: we can't validate without sending, so just confirm the
      // URL is reachable shape-wise. A real send is exercised via /send.
      return {
        success: Boolean(cfg.webhookUrl),
        message: cfg.webhookUrl ? 'Webhook URL configured' : 'No webhook URL',
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

  private truncate(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }
}
