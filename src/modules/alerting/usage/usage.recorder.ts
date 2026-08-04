import type { Pool, PoolClient } from 'pg';

export type AlertUsageKind =
  | 'alert_generated' | 'alert_suppressed' | 'alert_delivered' | 'alert_failed'
  | 'connector_send' | 'email_sent' | 'slack_message' | 'sms_sent'
  | 'webhook_call' | 'discord_message' | 'teams_message' | 'pagerduty_event' | 'delivery_retry';

export interface AlertUsageFact {
  organizationId: string;
  projectId?: string | null;
  usageKind: AlertUsageKind;
  idempotencyKey: string;
  quantity?: number;
  metadata?: Record<string, unknown>;
}

export class AlertUsageRecorder {
  constructor(private readonly db: Pool) {}

  async record(fact: AlertUsageFact, client?: PoolClient): Promise<boolean> {
    const db = client ?? this.db;
    const result = await db.query(
      `WITH reserved AS (
         INSERT INTO alert_runtime_idempotency_keys (namespace, organization_id, idempotency_key)
         VALUES ('usage_fact', $1, $4)
         ON CONFLICT DO NOTHING
         RETURNING organization_id, idempotency_key
       )
       INSERT INTO alert_usage_facts
         (organization_id, project_id, usage_kind, idempotency_key, quantity, metadata)
       SELECT $1, $2, $3::alert_usage_kind, $4, $5, $6::jsonb
         FROM reserved
       ON CONFLICT DO NOTHING`,
      [fact.organizationId, fact.projectId ?? null, fact.usageKind, fact.idempotencyKey, fact.quantity ?? 1, JSON.stringify(fact.metadata ?? {})],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
