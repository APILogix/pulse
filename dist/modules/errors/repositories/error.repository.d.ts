import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupEventRecord } from '../models/error-group.model.js';
export interface InsertErrorResult {
    inserted: boolean;
    id: string | null;
}
export declare class ErrorRepository {
    private readonly pool;
    constructor(pool: Pool);
    insertIfNew(client: PoolClient, record: ErrorGroupEventRecord): Promise<InsertErrorResult>;
    attachGroup(client: PoolClient, organizationId: string, eventId: string, occurredAt: Date, groupId: string): Promise<void>;
    insert(client: PoolClient, record: ErrorGroupEventRecord): Promise<boolean>;
    find(projectId: string, eventId: string): Promise<ErrorGroupEventRecord | null>;
    findByGroup(projectId: string, errorGroupId: string, limit?: number): Promise<ErrorGroupEventRecord[]>;
}
//# sourceMappingURL=error.repository.d.ts.map