/**
 * Microsoft Teams connector.
 *
 * Delivers Adaptive Cards via an Incoming Webhook connector URL. Teams expects
 * the card wrapped in an attachments envelope with the AdaptiveCard content
 * type.
 */
import type { ZodType } from 'zod';
import { BaseConnector } from './base.connector.js';
import { httpRequest, classifyHttpStatus } from './http.js';
import {
  TeamsConfigSchema,
  ConnectorDeliveryError,
  type ConnectionTestResult,
  type ConnectorType,
  type DeliveryResult,
  type NotificationPayload,
  type TeamsConfig,
} from '../types.js';

const SEVERITY_STYLE: Record<string, string> = {
  info: 'good',
  warning: 'warning',
  error: 'attention',
  critical: 'attention',
};

export class TeamsConnector extends BaseConnector {
  public readonly type: ConnectorType = 'teams';

  protected get configSchema(): ZodType {
    return TeamsConfigSchema;
  }

  supportsRichFormatting(): boolean { return true; }
  supportsThreading(): boolean { return false; }
  supportsAttachments(): boolean { return false; }

  private buildCard(n: NotificationPayload): Record<string, unknown> {
    const bodyItems: Array<Record<string, unknown>> = [
      {
        type: 'TextBlock',
        size: 'Large',
        weight: 'Bolder',
        text: n.title,
        wrap: true,
        color: SEVERITY_STYLE[n.severity] ?? 'default',
      },
      { type: 'TextBlock', text: n.body, wrap: true },
    ];

    if (n.fields?.length) {
      bodyItems.push({
        type: 'FactSet',
        facts: n.fields.slice(0, 20).map((f) => ({ title: f.label, value: f.value })),
      });
    }

    const actions = n.url
      ? [{ type: 'Action.OpenUrl', title: 'View details', url: n.url }]
      : [];

    return {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: bodyItems,
          ...(actions.length ? { actions } : {}),
        },
      }],
    };
  }

  protected async deliver(notification: NotificationPayload): Promise<DeliveryResult> {
    const cfg = this.config<TeamsConfig>();
    const start = Date.now();

    const res = await httpRequest(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.buildCard(notification)),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return { success: true, statusCode: res.status, responseBody: res.body, latencyMs };
    }
    const { retryable, category } = classifyHttpStatus(res.status);
    throw new ConnectorDeliveryError(
      `Teams webhook returned ${res.status}: ${res.body.slice(0, 200)}`,
      category,
      retryable,
      { statusCode: res.status },
    );
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const cfg = this.config<TeamsConfig>();
    // Teams webhook has no metadata endpoint; only configuration presence is
    // verifiable without sending. A live send is exercised via /send.
    return {
      success: Boolean(cfg.webhookUrl),
      message: cfg.webhookUrl ? 'Webhook URL configured' : 'No webhook URL',
      latencyMs: 0,
    };
  }
}
