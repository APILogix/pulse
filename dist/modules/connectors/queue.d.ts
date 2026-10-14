/**
 * Connector PGMQ queue wiring (Canonical V2 Delivery & Control Planes).
 *
 * TRANSPORT (notification delivery) - canonical V2 only:
 *   - connector_v2_<provider>       one consumer per registered provider
 *
 * CONTROL PLANE queues:
 *   - connector_health_check
 *   - connector_test
 *   - connector_secret_rotation
 *   - connector_oauth_refresh
 *   - connector_cleanup
 *   - connector_dead_letter_retry
 *   - connector_delivery_retry
 */
import type { FastifyBaseLogger } from 'fastify';
import type { NotificationPayload } from './types.js';
import type { Pool } from 'pg';
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
export interface ConnectorOAuthRefreshJobData {
    organizationId: string;
    connectorId: string;
}
export interface ConnectorDeliveryRetryJobData {
    organizationId: string;
    deliveryId: string;
    actorUserId?: string | null;
}
export type ConnectorWorkerGroup = 'all' | 'alert-delivery';
export interface ConnectorWorkerConfig {
    group?: ConnectorWorkerGroup;
    strictQueueCreation?: boolean;
}
export declare function registerConnectorWorkers(logger: FastifyBaseLogger, runtimeRepository?: AlertRuntimeRepository, config?: ConnectorWorkerConfig, primaryPool?: Pool): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map