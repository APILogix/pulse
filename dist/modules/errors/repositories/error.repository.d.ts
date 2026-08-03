import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupEventRecord } from '../models/error-group.model.ts';
export declare class ErrorRepository {
    private readonly pool;
    constructor(pool: Pool);
    /**
     * Inserts an error event using a given client (for transactions).
     */
    insert(client: PoolClient, record: ErrorGroupEventRecord): Promise<boolean>;
    find(projectId: string, eventId: string): Promise<ErrorGroupEventRecord | null>;
    findByGroup(projectId: string, errorGroupId: string): Promise<ErrorGroupEventRecord[]>;
}
//# sourceMappingURL=error.repository.d.ts.map