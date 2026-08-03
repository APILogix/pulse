import type { PoolClient } from 'pg';
import type { ErrorGroupRepository } from '../repositories/error-group.repository.ts';
import type { CreateErrorGroupParams } from '../models/error-group.model.ts';
export declare class ErrorGroupingService {
    private readonly errorGroupRepo;
    constructor(errorGroupRepo: ErrorGroupRepository);
    /**
     * Finds or creates an error group, updates statistics and detects regressions.
     * This logic is largely delegated to the atomic SQL in the repository.
     * Must be called within an active transaction.
     */
    handleGroup(client: PoolClient, params: CreateErrorGroupParams): Promise<{
        id: string;
        isNew: boolean;
        status: string;
        isRegression: boolean;
    }>;
}
//# sourceMappingURL=error-grouping.service.d.ts.map