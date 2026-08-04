import { domainEventBus } from '../../../shared/events/domain-event-bus.js';
export class ErrorIngestionService {
    pool;
    errorGroupingService;
    errorRepository;
    metrics;
    constructor(pool, errorGroupingService, errorRepository, metrics) {
        this.pool = pool;
        this.errorGroupingService = errorGroupingService;
        this.errorRepository = errorRepository;
        this.metrics = metrics;
    }
    /**
     * Ingests a single error event transactionally.
     * Guarantees idempotency: if the event is a duplicate, the transaction is rolled back,
     * meaning group counters are not artificially inflated.
     */
    async ingestError(groupParams, eventRecord) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await this.ingestErrorWithClient(client, groupParams, eventRecord);
            if (!result.inserted) {
                await client.query('ROLLBACK');
                return;
            }
            await client.query('COMMIT');
            this.publishDomainEvents(result.groupResult, eventRecord);
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async ingestErrorWithClient(client, groupParams, eventRecord) {
        const startTime = Date.now();
        // 1. Upsert group
        const t1 = Date.now();
        const groupResult = await this.errorGroupingService.handleGroup(client, groupParams);
        const t2 = Date.now();
        if (this.metrics) {
            this.metrics.recordErrorLatencies(null, t2 - t1, null, null);
        }
        // 2. Insert error event
        const fullEventRecord = {
            ...eventRecord,
            error_group_id: groupResult.id,
        };
        const inserted = await this.errorRepository.insert(client, fullEventRecord);
        if (!inserted) {
            // If event already exists, it's a duplicate retry. The caller-owned
            // transaction must roll back to undo the group counter bump.
            if (this.metrics)
                this.metrics.recordErrorDuplicate();
            return { inserted: false, groupResult };
        }
        if (this.metrics) {
            this.metrics.recordErrorGroup(groupResult.isNew, groupResult.isRegression);
            this.metrics.recordErrorLatencies(null, null, Date.now() - startTime, null);
        }
        return { inserted: true, groupResult };
    }
    publishDomainEvents(groupResult, eventRecord) {
        const eventStart = Date.now();
        // Publish internal domain events outside of transaction
        if (groupResult.isNew) {
            domainEventBus.publish('ErrorGroupCreated', {
                errorGroupId: groupResult.id,
                projectId: eventRecord.project_id,
                organizationId: eventRecord.organization_id,
                fingerprint: eventRecord.fingerprint,
                eventId: eventRecord.event_id,
            });
        }
        else if (groupResult.isRegression) {
            domainEventBus.publish('ErrorRegressed', {
                errorGroupId: groupResult.id,
                projectId: eventRecord.project_id,
                organizationId: eventRecord.organization_id,
                fingerprint: eventRecord.fingerprint,
                eventId: eventRecord.event_id,
            });
        }
        domainEventBus.publish('ErrorOccurred', {
            errorGroupId: groupResult.id,
            eventId: eventRecord.event_id,
            projectId: eventRecord.project_id,
            organizationId: eventRecord.organization_id,
            fingerprint: eventRecord.fingerprint,
        });
        if (this.metrics) {
            this.metrics.recordErrorLatencies(null, null, null, Date.now() - eventStart);
        }
    }
    async ingestBatch(client, errors) {
        let inserted = 0;
        const domainEvents = [];
        for (const error of errors) {
            const result = await this.ingestErrorWithClient(client, error.groupParams, error.eventRecord);
            if (!result.inserted) {
                throw new Error('DUPLICATE_ERROR_EVENT');
            }
            inserted++;
            domainEvents.push({ groupResult: result.groupResult, eventRecord: error.eventRecord });
        }
        return { inserted, domainEvents };
    }
    publishBatchDomainEvents(events) {
        for (const event of events) {
            this.publishDomainEvents(event.groupResult, event.eventRecord);
        }
    }
}
//# sourceMappingURL=error-ingestion.service.js.map