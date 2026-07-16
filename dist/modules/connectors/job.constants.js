export const CONNECTOR_JOBS = {
    send: 'connector-send',
    healthCheck: 'connector-health-check',
    test: 'connector-test',
    secretRotation: 'connector-secret-rotation',
    oauthRefresh: 'connector-oauth-refresh',
    cleanup: 'connector-cleanup',
    deadLetterRetry: 'connector-dead-letter-retry',
    deliveryRetry: 'connector-delivery-retry',
};
export const CONNECTOR_SEND_QUEUES = {
    critical: 'connector-send-critical',
    error: 'connector-send-error',
    warning: 'connector-send-warning',
    info: 'connector-send-info',
};
export const CONNECTOR_PRIORITY = {
    critical: 100,
    error: 80,
    warning: 50,
    info: 20,
};
//# sourceMappingURL=job.constants.js.map