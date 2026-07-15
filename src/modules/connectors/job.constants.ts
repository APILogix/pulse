export const CONNECTOR_JOBS = {
  send: 'connector-send',
  healthCheck: 'connector-health-check',
  test: 'connector-test',
  secretRotation: 'connector-secret-rotation',
  oauthRefresh: 'connector-oauth-refresh',
  cleanup: 'connector-cleanup',
  deadLetterRetry: 'connector-dead-letter-retry',
  deliveryRetry: 'connector-delivery-retry',
} as const;

export type ConnectorJobName = (typeof CONNECTOR_JOBS)[keyof typeof CONNECTOR_JOBS];
