import type { Pool, PoolClient } from 'pg';
export type AlertUsageKind = 'alert_generated' | 'alert_suppressed' | 'alert_delivered' | 'alert_failed' | 'connector_send' | 'email_sent' | 'slack_message' | 'sms_sent' | 'webhook_call' | 'discord_message' | 'teams_message' | 'pagerduty_event' | 'delivery_retry';
export interface AlertUsageFact {
    organizationId: string;
    projectId?: string | null;
    usageKind: AlertUsageKind;
    idempotencyKey: string;
    quantity?: number;
    metadata?: Record<string, unknown>;
}
export declare class AlertUsageRecorder {
    private readonly db;
    constructor(db: Pool);
    record(fact: AlertUsageFact, client?: PoolClient): Promise<boolean>;
}
//# sourceMappingURL=usage.recorder.d.ts.map