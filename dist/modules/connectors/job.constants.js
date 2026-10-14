/**
 * Connector control-plane job queues.
 */
export const CONNECTOR_JOBS = {
    healthCheck: 'connector_health_check',
    test: 'connector_test',
    secretRotation: 'connector_secret_rotation',
    oauthRefresh: 'connector_oauth_refresh',
    cleanup: 'connector_cleanup',
    deadLetterRetry: 'connector_dead_letter_retry',
    deliveryRetry: 'connector_delivery_retry',
};
/** Canonical prefix for provider transport queues. */
export const CONNECTOR_TRANSPORT_QUEUE_PREFIX = 'connector_v2_';
/**
 * THE canonical transport queue name for a provider.
 */
export function connectorTransportQueue(provider) {
    const clean = provider.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return `${CONNECTOR_TRANSPORT_QUEUE_PREFIX}${clean}`;
}
/** Extract the provider from a canonical transport queue name. */
export function providerFromTransportQueue(queue) {
    if (queue.startsWith('connector.v2.')) {
        return queue.slice('connector.v2.'.length);
    }
    if (queue.startsWith(CONNECTOR_TRANSPORT_QUEUE_PREFIX)) {
        return queue.slice(CONNECTOR_TRANSPORT_QUEUE_PREFIX.length);
    }
    return queue;
}
export const CONNECTOR_PRIORITY = {
    critical: 100,
    error: 80,
    warning: 50,
    info: 20,
};
//# sourceMappingURL=job.constants.js.map