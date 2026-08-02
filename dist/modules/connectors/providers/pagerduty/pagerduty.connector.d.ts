/**
 * PagerDuty connector — Events API v2.
 *
 * Triggers incidents via the Events API. Severity maps to PagerDuty's
 * (critical|error|warning|info) scale. A dedupKey lets repeated alerts collapse
 * onto a single incident.
 */
import type { ZodType } from 'zod';
import { BaseConnector } from '../../shared/base.connector.js';
import { type ConnectionTestResult, type ConnectorType, type DeliveryResult, type NotificationPayload } from '../../types.js';
export declare class PagerDutyConnector extends BaseConnector {
    readonly type: ConnectorType;
    protected get configSchema(): ZodType;
    supportsRichFormatting(): boolean;
    supportsThreading(): boolean;
    supportsAttachments(): boolean;
    protected deliver(notification: NotificationPayload): Promise<DeliveryResult>;
    testConnection(): Promise<ConnectionTestResult>;
}
//# sourceMappingURL=pagerduty.connector.d.ts.map