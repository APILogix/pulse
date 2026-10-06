import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupingService } from './error-grouping.service.js';
import type { ErrorRepository } from '../repositories/error.repository.js';
import type { ErrorGroupEventRecord } from '../models/error-group.model.js';
import type { UpsertErrorGroupParams, GroupMutationResult } from '../repositories/error-group.repository.js';
import type { Logger } from 'pino';
import type { WorkerMetrics } from '../../ingestion/workers/metrics-server.js';
export interface IngestionResult {
    inserted: boolean;
    groupResult: GroupMutationResult | null;
}
type ErrorBatchItem = {
    groupParams: UpsertErrorGroupParams;
    eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
};
export declare class ErrorIngestionService {
    private readonly pool;
    private readonly errorGroupingService;
    private readonly errorRepository;
    private readonly metrics?;
    /**
     * Optional so existing callers and unit tests keep working unchanged. Used
     * to surface the per-event grouping fallback, which is otherwise invisible.
     */
    private readonly log?;
    constructor(pool: Pool, errorGroupingService: ErrorGroupingService, errorRepository: ErrorRepository, metrics?: WorkerMetrics | undefined, 
    /**
     * Optional so existing callers and unit tests keep working unchanged. Used
     * to surface the per-event grouping fallback, which is otherwise invisible.
     */
    log?: Pick<Logger, "warn"> | undefined);
    ingestError(groupParams: UpsertErrorGroupParams, eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>): Promise<void>;
    private ingestErrorWithClient;
    private publishDomainEvents;
    ingestBatch(client: PoolClient, errors: ErrorBatchItem[], alreadyPersisted?: boolean): Promise<{
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
export {};
//# sourceMappingURL=error-ingestion.service.d.ts.map