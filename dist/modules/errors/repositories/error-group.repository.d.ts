import type { Pool, PoolClient } from 'pg';
import type { ErrorGroup, ErrorGroupStatus, CreateErrorGroupParams } from '../models/error-group.model.js';
export interface SnapshotParams {
    message?: string;
    errorName?: string;
    statusCode?: number;
    traceId?: string;
    requestId?: string;
}
export type UpsertErrorGroupParams = CreateErrorGroupParams & SnapshotParams;
export interface GroupMutationResult {
    id: string;
    isNew: boolean;
    status: ErrorGroupStatus;
    isRegression: boolean;
    regressionCount?: number;
}
export declare const ERROR_GROUP_COLUMNS = "\n  id, public_id, organization_id, project_id, fingerprint, fingerprint_version,\n  status, occurrence_count, first_seen_at, last_seen_at, first_event_id,\n  latest_event_id, latest_event_occurred_at, highest_severity, latest_severity,\n  regression_count, last_regressed_at, latest_release, latest_sdk_version,\n  latest_application_version, latest_environment, latest_service, resolved_at,\n  resolved_release, last_error_message, last_error_name, last_status_code,\n  last_trace_id, last_request_id, merged_into, is_merged, version, created_at, updated_at\n";
export declare const ERROR_GROUP_QUALIFIED_COLUMNS = "\n  g.id, g.public_id, g.organization_id, g.project_id, g.fingerprint, g.fingerprint_version,\n  g.status, g.occurrence_count, g.first_seen_at, g.last_seen_at, g.first_event_id,\n  g.latest_event_id, g.latest_event_occurred_at, g.highest_severity, g.latest_severity,\n  g.regression_count, g.last_regressed_at, g.latest_release, g.latest_sdk_version,\n  g.latest_application_version, g.latest_environment, g.latest_service, g.resolved_at,\n  g.resolved_release, g.last_error_message, g.last_error_name, g.last_status_code,\n  g.last_trace_id, g.last_request_id, g.merged_into, g.is_merged, g.version, g.created_at, g.updated_at\n";
export interface BatchErrorGroupItem extends UpsertErrorGroupParams {
    inputIndex: number;
}
export interface BatchErrorGroupResult {
    inputIndex: number;
    result: GroupMutationResult;
}
export declare class ErrorGroupRepository {
    private readonly pool;
    constructor(pool: Pool);
    upsertGroupsBatch(client: PoolClient, items: BatchErrorGroupItem[]): Promise<BatchErrorGroupResult[]>;
    upsertGroup(client: PoolClient, params: UpsertErrorGroupParams): Promise<GroupMutationResult>;
    private updateExistingGroup;
    private lockByFingerprint;
    private resolveEffectiveGroup;
    private resolveEffectiveGroupsBatch;
    private isNewer;
    private insertHistory;
    private insertRegressionOutbox;
    findByFingerprint(projectId: string, fingerprint: string): Promise<ErrorGroup | null>;
    resolve(client: PoolClient, projectId: string, id: string, release?: string | null): Promise<void>;
    ignore(client: PoolClient, projectId: string, id: string): Promise<void>;
    reopen(client: PoolClient, projectId: string, id: string): Promise<void>;
    archive(client: PoolClient, projectId: string, id: string): Promise<void>;
    private updateStatus;
    assign(_client: PoolClient, _projectId: string, _id: string, _userId: string): Promise<void>;
    private mapToDomain;
}
//# sourceMappingURL=error-group.repository.d.ts.map