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
import { type ConnectionTestResult, type ConnectorType, type DeliveryResult, type NotificationPayload } from '../../types.js';
export declare class SmsConnector extends BaseConnector {
    readonly type: ConnectorType;
    protected get configSchema(): ZodType;
    supportsRichFormatting(): boolean;
    supportsThreading(): boolean;
    supportsAttachments(): boolean;
    private renderMessage;
    protected deliver(notification: NotificationPayload): Promise<DeliveryResult>;
    testConnection(): Promise<ConnectionTestResult>;
}
//# sourceMappingURL=sms.connector.d.ts.map