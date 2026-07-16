import type { NotificationSeverity } from './types.js';

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

export type ConnectorJobName = (typeof CONNECTOR_JOBS)[keyof typeof CONNECTOR_JOBS] | string;

export const CONNECTOR_SEND_QUEUES: Record<NotificationSeverity, string> = {
  critical: 'connector-send-critical',
  error: 'connector-send-error',
  warning: 'connector-send-warning',
  info: 'connector-send-info',
};

export const CONNECTOR_PRIORITY: Record<NotificationSeverity, number> = {
  critical: 100,
  error: 80,
  warning: 50,
  info: 20,
};
