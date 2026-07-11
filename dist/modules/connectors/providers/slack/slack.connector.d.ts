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
import { type ConnectionTestResult, type ConnectorType, type DeliveryResult, type NotificationPayload } from '../../types.js';
export declare class SlackConnector extends BaseConnector {
    readonly type: ConnectorType;
    protected get configSchema(): ZodType;
    supportsRichFormatting(): boolean;
    supportsThreading(): boolean;
    supportsAttachments(): boolean;
    private buildBlocks;
    protected deliver(notification: NotificationPayload): Promise<DeliveryResult>;
    private deliverViaWebhook;
    private deliverViaApi;
    testConnection(): Promise<ConnectionTestResult>;
    private truncate;
}
//# sourceMappingURL=slack.connector.d.ts.map