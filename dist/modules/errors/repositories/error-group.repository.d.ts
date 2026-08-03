import type { Pool, PoolClient } from 'pg';
import type { ErrorGroup, CreateErrorGroupParams } from '../models/error-group.model.ts';
export interface SnapshotParams {
    message?: string;
    errorName?: string;
    statusCode?: number;
    traceId?: string;
    requestId?: string;
}
export type UpsertErrorGroupParams = CreateErrorGroupParams & SnapshotParams;
export declare class ErrorGroupRepository {
    private readonly pool;
    constructor(pool: Pool);
    /**
     * Atomically upserts an error group based on (project_id, fingerprint).
     * It handles group creation and updating statistics on repeat occurrences,
     * as well as regression detection (moving RESOLVED back to REGRESSED).
     */
    upsertGroup(client: PoolClient, params: UpsertErrorGroupParams): Promise<{
        id: string;
        isNew: boolean;
        status: string;
        isRegression: boolean;
    }>;
    findByFingerprint(projectId: string, fingerprint: string): Promise<ErrorGroup | null>;
    resolve(client: PoolClient, projectId: string, id: string): Promise<void>;
    ignore(client: PoolClient, projectId: string, id: string): Promise<void>;
    reopen(client: PoolClient, projectId: string, id: string): Promise<void>;
    archive(client: PoolClient, projectId: string, id: string): Promise<void>;
    assign(client: PoolClient, projectId: string, id: string, userId: string): Promise<void>;
    private mapToDomain;
}
//# sourceMappingURL=error-group.repository.d.ts.map