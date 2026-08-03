import type { Pool, PoolClient } from 'pg';
export interface CreateHistoryParams {
    groupId: string;
    action: string;
    oldValue?: Record<string, any> | null;
    newValue?: Record<string, any> | null;
    actorId?: string | null;
    metadata?: Record<string, any> | null;
}
export declare class ErrorGroupHistoryRepository {
    private readonly pool;
    constructor(pool: Pool);
    insertHistory(client: PoolClient, params: CreateHistoryParams): Promise<void>;
}
//# sourceMappingURL=error-group-history.repository.d.ts.map