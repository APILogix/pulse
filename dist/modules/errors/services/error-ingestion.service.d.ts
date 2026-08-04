import type { Pool, PoolClient } from 'pg';
import type { ErrorGroupingService } from './error-grouping.service.ts';
import type { ErrorRepository } from '../repositories/error.repository.ts';
import type { ErrorGroupEventRecord } from '../models/error-group.model.ts';
import type { UpsertErrorGroupParams } from '../repositories/error-group.repository.ts';
import type { WorkerMetrics } from '../../ingestion/workers/metrics-server.ts';
export declare class ErrorIngestionService {
    private readonly pool;
    private readonly errorGroupingService;
    private readonly errorRepository;
    private readonly metrics?;
    constructor(pool: Pool, errorGroupingService: ErrorGroupingService, errorRepository: ErrorRepository, metrics?: WorkerMetrics | undefined);
    /**
     * Ingests a single error event transactionally.
     * Guarantees idempotency: if the event is a duplicate, the transaction is rolled back,
     * meaning group counters are not artificially inflated.
     */
    ingestError(groupParams: UpsertErrorGroupParams, eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>): Promise<void>;
    private ingestErrorWithClient;
    private publishDomainEvents;
    ingestBatch(client: PoolClient, errors: Array<{
        groupParams: UpsertErrorGroupParams;
        eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
    }>): Promise<{
        inserted: number;
        domainEvents: Array<{
            groupResult: {
                id: string;
                isNew: boolean;
                status: string;
                isRegression: boolean;
            };
            eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
        }>;
    }>;
    publishBatchDomainEvents(events: Array<{
        groupResult: {
            id: string;
            isNew: boolean;
            status: string;
            isRegression: boolean;
        };
        eventRecord: Omit<ErrorGroupEventRecord, 'error_group_id'>;
    }>): void;
}
//# sourceMappingURL=error-ingestion.service.d.ts.map