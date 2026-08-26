import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupEventRecord } from '../models/error-group.model.js';
export interface InsertErrorResult {
    inserted: boolean;
    id: string | null;
}
export interface InsertedErrorRecord {
    id: string;
    organizationId: string;
    eventId: string;
    occurredAt: Date;
}
export interface ErrorGroupAttachment {
    organizationId: string;
    eventId: string;
    occurredAt: Date;
    groupId: string;
}
export declare class ErrorRepository {
    private readonly pool;
    constructor(pool: Pool);
    insertIfNew(client: PoolClient, record: ErrorGroupEventRecord): Promise<InsertErrorResult>;
    insertManyIfNew(client: PoolClient, records: ErrorGroupEventRecord[]): Promise<InsertedErrorRecord[]>;
    attachGroup(client: PoolClient, organizationId: string, eventId: string, occurredAt: Date, groupId: string): Promise<void>;
    attachGroups(client: PoolClient, attachments: ErrorGroupAttachment[]): Promise<void>;
    insert(client: PoolClient, record: ErrorGroupEventRecord): Promise<boolean>;
    find(projectId: string, eventId: string): Promise<ErrorGroupEventRecord | null>;
    findByGroup(projectId: string, errorGroupId: string, limit?: number): Promise<ErrorGroupEventRecord[]>;
}
//# sourceMappingURL=error.repository.d.ts.map