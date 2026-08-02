import type { ZodType } from 'zod';
import { BaseConnector } from '../../shared/base.connector.js';
import { type ConnectionTestResult, type ConnectorType, type DeliveryResult, type NotificationPayload } from '../../types.js';
export declare class WebhookConnector extends BaseConnector {
    readonly type: ConnectorType;
    protected get configSchema(): ZodType;
    supportsRichFormatting(): boolean;
    supportsThreading(): boolean;
    supportsAttachments(): boolean;
    private envelope;
    /** Compute the signature header value for a body. Exposed for verification reuse. */
    static signBody(secret: string, body: string, timestampSec: number): string;
    protected deliver(notification: NotificationPayload): Promise<DeliveryResult>;
    testConnection(): Promise<ConnectionTestResult>;
}
//# sourceMappingURL=webhook.connector.d.ts.map