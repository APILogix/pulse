import { domainEventBus } from '../../../shared/events/domain-event-bus.js';
function errorRecordKey(record) {
    return `${record.organization_id}\u0000${record.event_id}\u0000${record.occurred_at.getTime()}`;
}
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
        const insertStart = Date.now();
        const inserted = await this.errorRepository.insertIfNew(client, {
            ...eventRecord,
            error_group_id: null,
        });
        this.metrics?.recordStage('error_insert_row', 'error', Date.now() - insertStart);
        if (!inserted.inserted) {
            this.metrics?.recordErrorDuplicate();
            this.metrics?.recordStage('error_event_total', 'error', Date.now() - startTime);
            return { inserted: false, groupResult: null };
        }
        const groupStart = Date.now();
        const groupResult = await this.errorGroupingService.handleGroup(client, groupParams);
        const groupingMs = Date.now() - groupStart;
        this.metrics?.recordErrorLatencies(null, groupingMs, null, null);
        this.metrics?.recordStage('error_group_upsert', 'error', groupingMs);
        const attachStart = Date.now();
        await this.errorRepository.attachGroup(client, eventRecord.organization_id, eventRecord.event_id, eventRecord.occurred_at, groupResult.id);
        this.metrics?.recordStage('error_group_attach', 'error', Date.now() - attachStart);
        this.metrics?.recordErrorGroup(groupResult.isNew, groupResult.isRegression);
        const totalMs = Date.now() - startTime;
        this.metrics?.recordErrorLatencies(null, null, totalMs, null);
        this.metrics?.recordStage('error_event_total', 'error', totalMs);
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
        const batchStart = Date.now();
        const domainEvents = [];
        if (errors.length === 0) {
            this.metrics?.recordStage('error_batch_loop', 'error', Date.now() - batchStart);
            return { inserted: 0, domainEvents };
        }
        const insertStart = Date.now();
        const insertedRows = await this.errorRepository.insertManyIfNew(client, errors.map(({ eventRecord }) => ({ ...eventRecord, error_group_id: null })));
        this.metrics?.recordStage('error_bulk_insert', 'error', Date.now() - insertStart);
        const insertedByKey = new Map();
        for (const row of insertedRows) {
            const key = `${row.organizationId}\u0000${row.eventId}\u0000${row.occurredAt.getTime()}`;
            insertedByKey.set(key, (insertedByKey.get(key) ?? 0) + 1);
        }
        const attachments = [];
        for (const error of errors) {
            const eventStart = Date.now();
            const key = errorRecordKey(error.eventRecord);
            const remaining = insertedByKey.get(key) ?? 0;
            if (remaining <= 0) {
                this.metrics?.recordErrorDuplicate();
                this.metrics?.recordStage('error_event_total', 'error', Date.now() - eventStart);
                continue;
            }
            if (remaining === 1)
                insertedByKey.delete(key);
            else
                insertedByKey.set(key, remaining - 1);
            const groupStart = Date.now();
            const groupResult = await this.errorGroupingService.handleGroup(client, error.groupParams);
            const groupingMs = Date.now() - groupStart;
            this.metrics?.recordErrorLatencies(null, groupingMs, null, null);
            this.metrics?.recordStage('error_group_upsert', 'error', groupingMs);
            attachments.push({
                organizationId: error.eventRecord.organization_id,
                eventId: error.eventRecord.event_id,
                occurredAt: error.eventRecord.occurred_at,
                groupId: groupResult.id,
            });
            this.metrics?.recordErrorGroup(groupResult.isNew, groupResult.isRegression);
            const totalMs = Date.now() - eventStart;
            this.metrics?.recordErrorLatencies(null, null, totalMs, null);
            this.metrics?.recordStage('error_event_total', 'error', totalMs);
            domainEvents.push({ groupResult, eventRecord: error.eventRecord });
        }
        if (attachments.length > 0) {
            const attachStart = Date.now();
            await this.errorRepository.attachGroups(client, attachments);
            this.metrics?.recordStage('error_group_attach', 'error', Date.now() - attachStart);
        }
        this.metrics?.recordStage('error_batch_loop', 'error', Date.now() - batchStart);
        return { inserted: insertedRows.length, domainEvents };
    }
    publishBatchDomainEvents(events) {
        for (const event of events)
            this.publishDomainEvents(event.groupResult, event.eventRecord);
    }
}
//# sourceMappingURL=error-ingestion.service.js.map