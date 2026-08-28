import type { NotificationSeverity } from './types.js';
/**
 * Connector control-plane job queues.
 *
 * NOTE: there is deliberately NO `send` queue here any more. Notification
 * transport happens exclusively on the canonical V2 provider queues built by
 * {@link connectorTransportQueue}. The former `connector-send-<provider>`
 * family (and the never-used `connector-send-<severity>` variant) were a second,
 * parallel transport implementation with weaker tenant verification; they have
 * been removed so exactly one delivery path exists.
 */
export declare const CONNECTOR_JOBS: {
    readonly healthCheck: "connector-health-check";
    readonly test: "connector-test";
    readonly secretRotation: "connector-secret-rotation";
    readonly oauthRefresh: "connector-oauth-refresh";
    readonly cleanup: "connector-cleanup";
    readonly deadLetterRetry: "connector-dead-letter-retry";
    readonly deliveryRetry: "connector-delivery-retry";
};
export type ConnectorJobName = (typeof CONNECTOR_JOBS)[keyof typeof CONNECTOR_JOBS] | string;
/** Canonical prefix for provider transport queues. */
export declare const CONNECTOR_TRANSPORT_QUEUE_PREFIX = "connector.v2.";
/**
 * THE canonical transport queue name for a provider.
 *
 * Every producer (notification router, escalation) and every consumer
 * (registerConnectorWorkers) must derive the queue name from this function so
 * producer and consumer topology can never drift apart.
 */
export declare function connectorTransportQueue(provider: string): string;
/** Extract the provider from a canonical transport queue name. */
export declare function providerFromTransportQueue(queue: string): string;
export declare const CONNECTOR_PRIORITY: Record<NotificationSeverity, number>;
//# sourceMappingURL=job.constants.d.ts.map