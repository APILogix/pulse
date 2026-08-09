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
    async ingestError(groupParams, eventRecord) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await this.ingestErrorWithClient(client, groupParams, eventRecord);
            await client.query('COMMIT');
            if (result.inserted && result.groupResult)
                this.publishDomainEvents(result.groupResult, eventRecord);
        }
        catch (error) {
            await Promise.resolve(client.query('ROLLBACK')).catch(() => undefined);
            throw error;
        }
        finally {
            client.release();
        }
    }
    async ingestErrorWithClient(client, groupParams, eventRecord) {
        const startTime = Date.now();
        const inserted = await this.errorRepository.insertIfNew(client, {
            ...eventRecord,
            error_group_id: null,
        });
        if (!inserted.inserted) {
            this.metrics?.recordErrorDuplicate();
            return { inserted: false, groupResult: null };
        }
        const groupStart = Date.now();
        const groupResult = await this.errorGroupingService.handleGroup(client, groupParams);
        this.metrics?.recordErrorLatencies(null, Date.now() - groupStart, null, null);
        await this.errorRepository.attachGroup(client, eventRecord.organization_id, eventRecord.event_id, eventRecord.occurred_at, groupResult.id);
        this.metrics?.recordErrorGroup(groupResult.isNew, groupResult.isRegression);
        this.metrics?.recordErrorLatencies(null, null, Date.now() - startTime, null);
        return { inserted: true, groupResult };
    }
    publishDomainEvents(groupResult, eventRecord) {
        const eventStart = Date.now();
        if (groupResult.isNew) {
            domainEventBus.publish('ErrorGroupCreated', {
                errorGroupId: groupResult.id,
                projectId: eventRecord.project_id,
                organizationId: eventRecord.organization_id,
                fingerprint: eventRecord.fingerprint,
                eventId: eventRecord.event_id,
            });
        }
        if (groupResult.isRegression) {
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
        this.metrics?.recordErrorLatencies(null, null, null, Date.now() - eventStart);
    }
    async ingestBatch(client, errors) {
        let inserted = 0;
        const domainEvents = [];
        for (const error of errors) {
            const result = await this.ingestErrorWithClient(client, error.groupParams, error.eventRecord);
            if (!result.inserted || !result.groupResult)
                continue;
            inserted += 1;
            domainEvents.push({ groupResult: result.groupResult, eventRecord: error.eventRecord });
        }
        return { inserted, domainEvents };
    }
    publishBatchDomainEvents(events) {
        for (const event of events)
            this.publishDomainEvents(event.groupResult, event.eventRecord);
    }
}
//# sourceMappingURL=error-ingestion.service.js.map