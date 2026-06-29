/**
 * Discord connector.
 *
 * Delivers via incoming webhooks using rich embeds. Threading is supported by
 * appending `?thread_id=` when a threadKey is present.
 */
import type { ZodType } from 'zod';
import { BaseConnector } from './base.connector.js';
import { httpRequest, classifyHttpStatus } from './http.js';
import {
  DiscordConfigSchema,
  ConnectorDeliveryError,
  type ConnectionTestResult,
  type ConnectorType,
  type DeliveryResult,
  type DiscordConfig,
  type NotificationPayload,
} from '../types.js';

// Discord embed color is a decimal integer.
const SEVERITY_COLOR: Record<string, number> = {
  info: 0x36a64f,
  warning: 0xdaa038,
  error: 0xd64f4f,
  critical: 0xa30000,
};

export class DiscordConnector extends BaseConnector {
  public readonly type: ConnectorType = 'discord';

  protected get configSchema(): ZodType {
    return DiscordConfigSchema;
  }

  supportsRichFormatting(): boolean { return true; }
  supportsThreading(): boolean { return true; }
  supportsAttachments(): boolean { return false; }

  private buildPayload(n: NotificationPayload, cfg: DiscordConfig): Record<string, unknown> {
    const embed: Record<string, unknown> = {
      title: n.title.slice(0, 256),
      description: n.body.slice(0, 4096),
      color: SEVERITY_COLOR[n.severity] ?? SEVERITY_COLOR.info,
      timestamp: new Date().toISOString(),
      ...(n.url ? { url: n.url } : {}),
    };

    if (n.fields?.length) {
      embed.fields = n.fields.slice(0, 25).map((f) => ({
        name: f.label.slice(0, 256),
        value: f.value.slice(0, 1024),
        inline: f.short ?? false,
      }));
    }

    return {
      ...(cfg.username ? { username: cfg.username } : {}),
      ...(cfg.avatarUrl ? { avatar_url: cfg.avatarUrl } : {}),
      embeds: [embed],
    };
  }

  protected async deliver(notification: NotificationPayload): Promise<DeliveryResult> {
    const cfg = this.config<DiscordConfig>();
    const payload = this.buildPayload(notification, cfg);

    let url = cfg.webhookUrl;
    if (notification.threadKey) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}thread_id=${encodeURIComponent(notification.threadKey)}`;
    }
    // wait=true makes Discord return the created message object (with id).
    const sep = url.includes('?') ? '&' : '?';
    url = `${url}${sep}wait=true`;

    const start = Date.now();
    const res = await httpRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      let externalMessageId = '';
      try { externalMessageId = (JSON.parse(res.body) as { id?: string }).id ?? ''; } catch { /* ignore */ }
      return { success: true, statusCode: res.status, externalMessageId, responseBody: res.body, latencyMs };
    }

    const { retryable, category } = classifyHttpStatus(res.status);
    throw new ConnectorDeliveryError(
      `Discord webhook returned ${res.status}: ${res.body.slice(0, 200)}`,
      category,
      retryable,
      { statusCode: res.status },
    );
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const cfg = this.config<DiscordConfig>();
    const start = Date.now();
    try {
      // GET on a webhook URL returns its metadata without posting a message.
      const res = await httpRequest(cfg.webhookUrl, { method: 'GET' });
      return {
        success: res.ok,
        message: res.ok ? 'Webhook reachable' : `Webhook returned ${res.status}`,
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
