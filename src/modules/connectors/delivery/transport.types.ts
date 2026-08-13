import type { NotificationSeverity } from '../types.js';

export interface ConnectorTransportJob {
  organizationId: string;
  notificationJobId: string;
  connectorId: string;
  channelKind: string;
  severity: NotificationSeverity;
  idempotencyKey: string;
  correlationId: string;
  notificationType?: string;
  routingDecisionHash?: string | null;
  payload: Record<string, unknown>;
}

export function isConnectorTransportJob(value: unknown): value is ConnectorTransportJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Record<string, unknown>;
  return typeof job.organizationId === 'string'
    && typeof job.notificationJobId === 'string'
    && typeof job.connectorId === 'string'
    && typeof job.channelKind === 'string'
    && typeof job.severity === 'string'
    && typeof job.idempotencyKey === 'string'
    && typeof job.correlationId === 'string'
    && !!job.payload
    && typeof job.payload === 'object'
    && !Array.isArray(job.payload);
}

export interface ManagedEmailJobData {
  organizationId: string;
  notificationJobId: string;
  projectId: string | null;
  alertEventId?: string | null;
  alertKey: string;
  ruleId?: string | null;
  deliveryMode: string;
  recipientType: string;
  recipientUserId: string;
  recipientEmail: string;
  provider: string;
  severity: NotificationSeverity;
  idempotencyKey: string;
  routingDecisionHash?: string | null;
  payload: Record<string, unknown>;
}

export function isManagedEmailJob(value: unknown): value is ManagedEmailJobData {
  if (!value || typeof value !== 'object') return false;
  const job = value as Record<string, unknown>;
  return typeof job.organizationId === 'string'
    && typeof job.notificationJobId === 'string'
    && typeof job.recipientUserId === 'string'
    && typeof job.recipientEmail === 'string'
    && (job.provider === 'MANAGED_EMAIL' || job.provider === 'EMAIL' || !job.connectorId)
    && typeof job.severity === 'string'
    && typeof job.idempotencyKey === 'string'
    && !!job.payload
    && typeof job.payload === 'object'
    && !Array.isArray(job.payload);
}
