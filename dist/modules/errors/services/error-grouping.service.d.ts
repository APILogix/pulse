import type { PoolClient } from 'pg';
import type { BatchErrorGroupItem, BatchErrorGroupResult, ErrorGroupRepository, UpsertErrorGroupParams, GroupMutationResult } from '../repositories/error-group.repository.js';
export declare class ErrorGroupingService {
    private readonly errorGroupRepo;
    constructor(errorGroupRepo: ErrorGroupRepository);
    handleGroup(client: PoolClient, params: UpsertErrorGroupParams): Promise<GroupMutationResult>;
    handleGroupsBatch(client: PoolClient, items: BatchErrorGroupItem[]): Promise<BatchErrorGroupResult[]>;
}
//# sourceMappingURL=error-grouping.service.d.ts.map