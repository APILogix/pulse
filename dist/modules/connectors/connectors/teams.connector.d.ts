/**
 * Microsoft Teams connector.
 *
 * Delivers Adaptive Cards via an Incoming Webhook connector URL. Teams expects
 * the card wrapped in an attachments envelope with the AdaptiveCard content
 * type.
 */
import type { ZodType } from 'zod';
import { BaseConnector } from './base.connector.js';
import { type ConnectionTestResult, type ConnectorType, type DeliveryResult, type NotificationPayload } from '../types.js';
export declare class TeamsConnector extends BaseConnector {
    readonly type: ConnectorType;
    protected get configSchema(): ZodType;
    supportsRichFormatting(): boolean;
    supportsThreading(): boolean;
    supportsAttachments(): boolean;
    private buildCard;
    protected deliver(notification: NotificationPayload): Promise<DeliveryResult>;
    testConnection(): Promise<ConnectionTestResult>;
}
//# sourceMappingURL=teams.connector.d.ts.map