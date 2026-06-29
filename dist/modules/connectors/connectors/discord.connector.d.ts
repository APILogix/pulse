/**
 * Discord connector.
 *
 * Delivers via incoming webhooks using rich embeds. Threading is supported by
 * appending `?thread_id=` when a threadKey is present.
 */
import type { ZodType } from 'zod';
import { BaseConnector } from './base.connector.js';
import { type ConnectionTestResult, type ConnectorType, type DeliveryResult, type NotificationPayload } from '../types.js';
export declare class DiscordConnector extends BaseConnector {
    readonly type: ConnectorType;
    protected get configSchema(): ZodType;
    supportsRichFormatting(): boolean;
    supportsThreading(): boolean;
    supportsAttachments(): boolean;
    private buildPayload;
    protected deliver(notification: NotificationPayload): Promise<DeliveryResult>;
    testConnection(): Promise<ConnectionTestResult>;
}
//# sourceMappingURL=discord.connector.d.ts.map