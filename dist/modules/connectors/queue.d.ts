/**
 * Connector pg-boss queue wiring.
 *
 * Required queues:
 *   - connector-send
 *   - connector-health-check
 *   - connector-test
 *   - connector-secret-rotation
 *   - connector-oauth-refresh
 *   - connector-cleanup
 *   - connector-dead-letter-retry
 *   - connector-delivery-retry
 */
import type { FastifyBaseLogger } from 'fastify';
import type { NotificationPayload } from './types.js';
import { AlertRuntimeRepository } from '../alerting/runtime/alert-runtime.repository.js';
export interface ConnectorSendJobData {
    organizationId: string;
    connectorId: string;
    payload: NotificationPayload;
    routeId?: string | null;
    projectChannel?: {
        userId?: string;
        channelId?: string;
        channelType?: string;
        destination?: string | null;
        metadata?: Record<string, unknown>;
    };
}
export interface ConnectorTestJobData {
    organizationId: string;
    connectorId: string;
}
export interface ConnectorSecretRotationJobData {
    organizationId: string;
    connectorId: string;
    config: Record<string, unknown>;
    actorUserId?: string | null;
}
export interface ConnectorDeliveryRetryJobData {
    organizationId: string;
    deliveryId: string;
    actorUserId?: string | null;
}
export interface ConnectorOAuthRefreshJobData {
    organizationId: string;
    connectorId: string;
}
export declare function registerConnectorWorkers(logger: FastifyBaseLogger, runtimeRepository?: AlertRuntimeRepository): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map