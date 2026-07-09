import type { Pool, PoolClient } from 'pg';
type Db = Pool | PoolClient;
export interface CurrentUsageRow {
    organization_id: string;
    period_start: Date;
    period_end: Date;
    events_used: number;
    event_limit: number;
    remaining_events: number;
    ai_credits_used: number;
    ai_credit_limit: number;
    remaining_ai_credits: number;
    projects_used: number;
    members_used: number;
    api_keys_used: number;
    connectors_used: number;
    alert_rules_used: number;
    dashboards_used: number;
}
export declare class UsageRepository {
    private readonly db;
    constructor(db?: Pool);
    getCurrentUsage(orgId: string, db?: Db): Promise<CurrentUsageRow | null>;
    incrementEventUsage(orgId: string, count?: number, db?: Db): Promise<void>;
    getDailyUsageRecords(orgId: string, startDate?: Date, endDate?: Date, db?: Db): Promise<any[]>;
}
export {};
//# sourceMappingURL=repository.d.ts.map