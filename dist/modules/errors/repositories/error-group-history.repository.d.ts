import type { Pool, PoolClient } from 'pg';
export interface CreateHistoryParams {
    groupId: string;
    action: string;
    previousStatus?: string | null;
    newStatus?: string | null;
    actorId?: string | null;
    actorType?: string;
    eventId?: string | null;
    release?: string | null;
    occurredAt?: Date | null;
    reason?: string | null;
    sourceGroupId?: string | null;
    targetGroupId?: string | null;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
}
export declare class ErrorGroupHistoryRepository {
    private readonly pool;
    constructor(pool: Pool);
    insertHistory(client: PoolClient, params: CreateHistoryParams): Promise<void>;
}
//# sourceMappingURL=error-group-history.repository.d.ts.map