import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupingService } from './error-grouping.service.js';
import type { ErrorRepository } from '../repositories/error.repository.js';
import type { ErrorGroupEventRecord } from '../models/error-group.model.js';
import type { UpsertErrorGroupParams, GroupMutationResult } from '../repositories/error-group.repository.js';
import type { WorkerMetrics } from '../../ingestion/workers/metrics-server.js';
export interface IngestionResult {
    inserted: boolean;
    groupResult: GroupMutationResult | null;
}
export declare class ErrorIngestionService {
    private readonly pool;
    private readonly errorGroupingService;
    private readonly errorRepository;
    private readonly metrics?;
    constructor(pool: Pool, errorGroupingService: ErrorGroupingService, errorRepository: ErrorRepository, metrics?: WorkerMetrics | undefined);
    ingestError(groupParams: UpsertErrorGroupParams, eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>): Promise<void>;
    private ingestErrorWithClient;
    private publishDomainEvents;
    ingestBatch(client: PoolClient, errors: Array<{
        groupParams: UpsertErrorGroupParams;
        eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
    }>): Promise<{
        inserted: number;
        domainEvents: Array<{
            groupResult: GroupMutationResult;
            eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
        }>;
    }>;
    publishBatchDomainEvents(events: Array<{
        groupResult: GroupMutationResult;
        eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
    }>): void;
}
//# sourceMappingURL=error-ingestion.service.d.ts.map