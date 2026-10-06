import type { Pool, PoolClient } from 'pg';
type Db = Pool | PoolClient;
export interface CurrentUsageRow {
    organization_id: string;
    period_start: Date;
    period_end: Date;
    events_used: number | string;
    event_limit: number | string;
    remaining_events: number | string;
    ai_credits_used: number | string;
    ai_credit_limit: number | string;
    remaining_ai_credits: number | string;
    projects_used: number | string;
    members_used: number | string;
    api_keys_used: number | string;
    connectors_used: number | string;
    alert_rules_used: number | string;
    dashboards_used: number | string;
}
type UsageBucket = 'minute' | 'hour' | 'day';
export declare const CURRENT_USAGE_COLUMNS = "\n  organization_id, period_start, period_end, events_used, event_limit, remaining_events,\n  ai_credits_used, ai_credit_limit, remaining_ai_credits, projects_used, members_used,\n  api_keys_used, connectors_used, alert_rules_used, dashboards_used\n";
export declare const USAGE_DAILY_COUNTER_COLUMNS = "\n  id, organization_id, project_id, usage_date, events_count, ai_credits_used,\n  requests_count, errors_count, traces_count, spans_count, metrics_count,\n  logs_count, profiles_count, replays_count, alert_notifications_count,\n  connector_sends_count, email_sends_count, slack_sends_count, sms_sends_count,\n  webhook_sends_count, created_at, updated_at\n";
export declare class UsageRepository {
    private readonly db;
    constructor(db?: Pool);
    getCurrentUsage(orgId: string, db?: Db): Promise<CurrentUsageRow | null>;
    isActiveOrganizationMember(orgId: string, userId: string, db?: Db): Promise<boolean>;
    incrementEventUsage(orgId: string, count?: number, db?: Db, rawCount?: number): Promise<void>;
    getDailyUsageRecords(orgId: string, startDate?: Date, endDate?: Date, limit?: number, db?: Db): Promise<any[]>;
    getProjectAttribution(orgId: string, options: {
        bucket: UsageBucket;
        startDate?: Date;
        endDate?: Date;
        projectId?: string;
        limit: number;
        offset: number;
    }, db?: Db): Promise<any[]>;
    getApiKeyAttribution(orgId: string, options: {
        startDate?: Date;
        endDate?: Date;
        projectId?: string;
        limit: number;
        offset: number;
    }, db?: Db): Promise<any[]>;
}
export {};
//# sourceMappingURL=repository.d.ts.map