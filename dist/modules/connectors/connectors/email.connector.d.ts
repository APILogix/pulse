import type { ZodType } from 'zod';
import { BaseConnector } from './base.connector.js';
import { type ConnectionTestResult, type ConnectorContext, type ConnectorType, type DeliveryResult, type NotificationPayload } from '../types.js';
export declare class EmailConnector extends BaseConnector {
    readonly type: ConnectorType;
    private transporter;
    constructor(ctx: ConnectorContext);
    protected get configSchema(): ZodType;
    supportsRichFormatting(): boolean;
    supportsThreading(): boolean;
    supportsAttachments(): boolean;
    private getTransporter;
    private renderHtml;
    private renderText;
    protected deliver(notification: NotificationPayload): Promise<DeliveryResult>;
    testConnection(): Promise<ConnectionTestResult>;
}
//# sourceMappingURL=email.connector.d.ts.map