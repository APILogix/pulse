import type { NotificationSeverity } from './types.js';
export declare const CONNECTOR_JOBS: {
    readonly send: "connector-send";
    readonly healthCheck: "connector-health-check";
    readonly test: "connector-test";
    readonly secretRotation: "connector-secret-rotation";
    readonly oauthRefresh: "connector-oauth-refresh";
    readonly cleanup: "connector-cleanup";
    readonly deadLetterRetry: "connector-dead-letter-retry";
    readonly deliveryRetry: "connector-delivery-retry";
};
export type ConnectorJobName = (typeof CONNECTOR_JOBS)[keyof typeof CONNECTOR_JOBS] | string;
export declare const CONNECTOR_SEND_QUEUES: Record<NotificationSeverity, string>;
export declare const CONNECTOR_PRIORITY: Record<NotificationSeverity, number>;
//# sourceMappingURL=job.constants.d.ts.map