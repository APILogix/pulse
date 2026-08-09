import type { Pool, PoolClient } from 'pg';
export type LegacyAlertingSource = 'project_alert_thresholds' | 'organization_alert_thresholds';
export type LegacyMappingStatus = 'pending' | 'mapped' | 'quarantined' | 'verified' | 'failed';
export interface LegacyAlertingMappingInput {
    organizationId: string;
    projectId: string | null;
    legacySource: LegacyAlertingSource;
    legacySourceId: string;
    sourceRevision: string | null;
    sourcePayload: Record<string, unknown>;
    canonicalRuleId?: string | null;
    canonicalBindingId?: string | null;
    status?: LegacyMappingStatus;
    error?: string | null;
    checkpoint?: string | null;
}
export declare class LegacyAlertingMapper {
    private readonly db;
    constructor(db: Pool);
    record(input: LegacyAlertingMappingInput, client?: PoolClient): Promise<void>;
    withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T>;
}
//# sourceMappingURL=legacy-alerting-mapper.d.ts.map