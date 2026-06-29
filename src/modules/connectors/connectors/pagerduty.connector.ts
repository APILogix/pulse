/**
 * PagerDuty connector — Events API v2.
 *
 * Triggers incidents via the Events API. Severity maps to PagerDuty's
 * (critical|error|warning|info) scale. A dedupKey lets repeated alerts collapse
 * onto a single incident.
 */
import type { ZodType } from 'zod';
import { BaseConnector } from './base.connector.js';
import { httpRequest, classifyHttpStatus } from './http.js';
import {
  PagerDutyConfigSchema,
  ConnectorDeliveryError,
  type ConnectionTestResult,
  type ConnectorType,
  type DeliveryResult,
  type NotificationPayload,
  type PagerDutyConfig,
} from '../types.js';

const EVENTS_API_URL = 'https://events.pagerduty.com/v2/enqueue';

// Our severities already line up with PagerDuty's, except 'info' which is valid.
const SEVERITY_MAP: Record<string, string> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
  critical: 'critical',
};

export class PagerDutyConnector extends BaseConnector {
  public readonly type: ConnectorType = 'pagerduty';

  protected get configSchema(): ZodType {
    return PagerDutyConfigSchema;
  }

  supportsRichFormatting(): boolean { return false; }
  supportsThreading(): boolean { return false; }
  supportsAttachments(): boolean { return false; }

  protected async deliver(notification: NotificationPayload): Promise<DeliveryResult> {
    const cfg = this.config<PagerDutyConfig>();
    const severity = cfg.defaultSeverityMap?.[notification.severity]
      ?? SEVERITY_MAP[notification.severity]
      ?? 'error';

    const customDetails: Record<string, unknown> = {
      body: notification.body,
      ...(notification.metadata ?? {}),
    };
    for (const f of notification.fields ?? []) customDetails[f.label] = f.value;

    const event = {
      routing_key: cfg.routingKey,
      event_action: 'trigger',
      ...(notification.dedupKey ? { dedup_key: notification.dedupKey } : {}),
      payload: {
        summary: notification.title.slice(0, 1024),
        source: 'pulse',
        severity,
        custom_details: customDetails,
      },
      ...(notification.url ? { links: [{ href: notification.url, text: 'View details' }] } : {}),
    };

    const start = Date.now();
    const res = await httpRequest(EVENTS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    const latencyMs = Date.now() - start;

    if (res.status === 202) {
      let dedupKey = '';
      try { dedupKey = (JSON.parse(res.body) as { dedup_key?: string }).dedup_key ?? ''; } catch { /* ignore */ }
      return { success: true, statusCode: res.status, externalMessageId: dedupKey, responseBody: res.body, latencyMs };
    }
    if (res.status === 400) {
      throw new ConnectorDeliveryError(
        `PagerDuty rejected event: ${res.body.slice(0, 200)}`,
        'invalid_payload',
        false,
      );
    }
    const { retryable, category } = classifyHttpStatus(res.status);
    throw new ConnectorDeliveryError(
      `PagerDuty Events API returned ${res.status}: ${res.body.slice(0, 200)}`,
      category,
      retryable,
      { statusCode: res.status },
    );
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const cfg = this.config<PagerDutyConfig>();
    // The Events API has no read endpoint; routing keys are 32 chars. We
    // validate shape only — a live trigger would create a real incident.
    const looksValid = typeof cfg.routingKey === 'string' && cfg.routingKey.length >= 20;
    return {
      success: looksValid,
      message: looksValid ? 'Routing key configured' : 'Routing key looks invalid',
      latencyMs: 0,
    };
  }
}
