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
//# sourceMappingURL=transport.types.d.ts.map