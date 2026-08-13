import type { NotificationSeverity } from '../types.js';
export interface ConnectorTransportJob {
    organizationId: string;
    notificationJobId: string;
    connectorId: string;
    channelKind: string;
    severity: NotificationSeverity;
    idempotencyKey: string;
    correlationId: string;
    notificationType?: string;
    routingDecisionHash?: string | null;
    payload: Record<string, unknown>;
}
export declare function isConnectorTransportJob(value: unknown): value is ConnectorTransportJob;
export interface ManagedEmailJobData {
    organizationId: string;
    notificationJobId: string;
    projectId: string | null;
    alertEventId?: string | null;
    alertKey: string;
    ruleId?: string | null;
    deliveryMode: string;
    recipientType: string;
    recipientUserId: string;
    recipientEmail: string;
    provider: string;
    severity: NotificationSeverity;
    idempotencyKey: string;
    routingDecisionHash?: string | null;
    payload: Record<string, unknown>;
}
export declare function isManagedEmailJob(value: unknown): value is ManagedEmailJobData;
//# sourceMappingURL=transport.types.d.ts.map