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
export declare class ErrorGroupRepository {
    private readonly pool;
    constructor(pool: Pool);
    upsertGroup(client: PoolClient, params: UpsertErrorGroupParams): Promise<GroupMutationResult>;
    private updateExistingGroup;
    private lockByFingerprint;
    private resolveEffectiveGroup;
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