import type { NotificationSeverity } from './types.js';
/**
 * Connector control-plane job queues.
 */
export declare const CONNECTOR_JOBS: {
    readonly healthCheck: "connector_health_check";
    readonly test: "connector_test";
    readonly secretRotation: "connector_secret_rotation";
    readonly oauthRefresh: "connector_oauth_refresh";
    readonly cleanup: "connector_cleanup";
    readonly deadLetterRetry: "connector_dead_letter_retry";
    readonly deliveryRetry: "connector_delivery_retry";
};
export type ConnectorJobName = (typeof CONNECTOR_JOBS)[keyof typeof CONNECTOR_JOBS] | string;
/** Canonical prefix for provider transport queues. */
export declare const CONNECTOR_TRANSPORT_QUEUE_PREFIX = "connector_v2_";
/**
 * THE canonical transport queue name for a provider.
 */
export declare function connectorTransportQueue(provider: string): string;
/** Extract the provider from a canonical transport queue name. */
export declare function providerFromTransportQueue(queue: string): string;
export declare const CONNECTOR_PRIORITY: Record<NotificationSeverity, number>;
//# sourceMappingURL=job.constants.d.ts.map