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
export declare class UsageRepository {
    private readonly db;
    constructor(db?: Pool);
    getCurrentUsage(orgId: string, db?: Db): Promise<CurrentUsageRow | null>;
    isActiveOrganizationMember(orgId: string, userId: string, db?: Db): Promise<boolean>;
    incrementEventUsage(orgId: string, count?: number, db?: Db): Promise<void>;
    getDailyUsageRecords(orgId: string, startDate?: Date, endDate?: Date, db?: Db): Promise<any[]>;
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