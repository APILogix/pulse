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
export const CONNECTOR_JOBS = {
    healthCheck: 'connector-health-check',
    test: 'connector-test',
    secretRotation: 'connector-secret-rotation',
    oauthRefresh: 'connector-oauth-refresh',
    cleanup: 'connector-cleanup',
    deadLetterRetry: 'connector-dead-letter-retry',
    deliveryRetry: 'connector-delivery-retry',
};
/** Canonical prefix for provider transport queues. */
export const CONNECTOR_TRANSPORT_QUEUE_PREFIX = 'connector.v2.';
/**
 * THE canonical transport queue name for a provider.
 *
 * Every producer (notification router, escalation) and every consumer
 * (registerConnectorWorkers) must derive the queue name from this function so
 * producer and consumer topology can never drift apart.
 */
export function connectorTransportQueue(provider) {
    return `${CONNECTOR_TRANSPORT_QUEUE_PREFIX}${provider.trim().toLowerCase()}`;
}
/** Extract the provider from a canonical transport queue name. */
export function providerFromTransportQueue(queue) {
    return queue.startsWith(CONNECTOR_TRANSPORT_QUEUE_PREFIX)
        ? queue.slice(CONNECTOR_TRANSPORT_QUEUE_PREFIX.length)
        : queue;
}
export const CONNECTOR_PRIORITY = {
    critical: 100,
    error: 80,
    warning: 50,
    info: 20,
};
//# sourceMappingURL=job.constants.js.map