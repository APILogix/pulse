import type { ZodType } from 'zod';
import { BaseConnector } from '../../shared/base.connector.js';
import { type ConnectionTestResult, type ConnectorContext, type ConnectorType, type DeliveryResult, type NotificationPayload } from '../../types.js';
export declare class EmailConnector extends BaseConnector {
    readonly type: ConnectorType;
    private transporter;
    constructor(ctx: ConnectorContext);
    protected get configSchema(): ZodType;
    supportsRichFormatting(): boolean;
    supportsThreading(): boolean;
    supportsAttachments(): boolean;
    private getTransporter;
    /**
     * Non-alert notifications (connector tests, generic payloads) render through
     * the shared Mono template, so they arrive in the same sheet as every other
     * Pulsiv email instead of an unstyled light page.
     */
    private renderFallback;
    protected deliver(notification: NotificationPayload): Promise<DeliveryResult>;
    testConnection(): Promise<ConnectionTestResult>;
}
//# sourceMappingURL=email.connector.d.ts.map