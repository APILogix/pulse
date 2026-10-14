import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorIngestionService } from './error-ingestion.service.js';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';
function event() {
    return {
        id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-1',
        fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error',
        occurred_at: new Date(), timestamp: new Date(), payload: {},
    };
}
describe('ErrorIngestionService', () => {
    let service;
    let pool;
    let client;
    let grouping;
    let errors;
    let metrics;
    beforeEach(() => {
        vi.clearAllMocks();
        client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
        pool = { connect: vi.fn().mockResolvedValue(client) };
        grouping = { handleGroup: vi.fn(), handleGroupsBatch: vi.fn() };
        errors = { insertIfNew: vi.fn(), insertManyIfNew: vi.fn(), attachGroup: vi.fn(), attachGroups: vi.fn() };
        metrics = {
            recordStage: vi.fn(),
            recordErrorDuplicate: vi.fn(),
            recordErrorLatencies: vi.fn(),
            recordErrorGroup: vi.fn(),
        };
        service = new ErrorIngestionService(pool, grouping, errors, metrics);
        vi.spyOn(domainEventBus, 'publish').mockImplementation(() => { });
    });
    it('inserts the event before grouping and commits the group association', async () => {
        errors.insertIfNew.mockResolvedValue({ inserted: true, id: 'event-row' });
        grouping.handleGroup.mockResolvedValue({ id: 'group-id', isNew: true, isRegression: false, status: 'OPEN', regressionCount: 0 });
        await service.ingestError({ organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' }, event());
        expect(errors.insertIfNew).toHaveBeenCalled();
        expect(grouping.handleGroup).toHaveBeenCalled();
        expect(errors.attachGroup).toHaveBeenCalledWith(client, 'org-1', 'evt-1', expect.any(Date), 'group-id');
        expect(client.query).toHaveBeenCalledWith('COMMIT');
        expect(domainEventBus.publish).toHaveBeenCalledWith('ErrorGroupCreated', expect.any(Object));
        expect(metrics.recordStage).toHaveBeenCalledWith('error_insert_row', 'error', expect.any(Number));
        expect(metrics.recordStage).toHaveBeenCalledWith('error_group_upsert', 'error', expect.any(Number));
        expect(metrics.recordStage).toHaveBeenCalledWith('error_group_attach', 'error', expect.any(Number));
        expect(metrics.recordStage).toHaveBeenCalledWith('error_event_total', 'error', expect.any(Number));
    });
    it('does not mutate grouping or publish events for duplicate retries', async () => {
        errors.insertIfNew.mockResolvedValue({ inserted: false, id: null });
        await service.ingestError({ organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' }, event());
        expect(grouping.handleGroup).not.toHaveBeenCalled();
        expect(errors.attachGroup).not.toHaveBeenCalled();
        expect(client.query).toHaveBeenCalledWith('COMMIT');
        expect(domainEventBus.publish).not.toHaveBeenCalled();
        expect(metrics.recordErrorDuplicate).toHaveBeenCalled();
        expect(metrics.recordStage).toHaveBeenCalledWith('error_insert_row', 'error', expect.any(Number));
        expect(metrics.recordStage).toHaveBeenCalledWith('error_event_total', 'error', expect.any(Number));
    });
    it('rolls back when grouping fails after a new event insert', async () => {
        errors.insertIfNew.mockResolvedValue({ inserted: true, id: 'event-row' });
        grouping.handleGroup.mockRejectedValue(new Error('DB Error'));
        await expect(service.ingestError({ organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' }, event())).rejects.toThrow('DB Error');
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalled();
    });
    it('bulk inserts error batches before grouping inserted rows', async () => {
        const first = event();
        const second = { ...event(), id: '2', event_id: 'evt-2' };
        errors.insertManyIfNew.mockResolvedValue([
            {
                id: 'event-row-1',
                organizationId: first.organization_id,
                eventId: first.event_id,
                occurredAt: first.occurred_at,
            },
            {
                id: 'event-row-2',
                organizationId: second.organization_id,
                eventId: second.event_id,
                occurredAt: second.occurred_at,
            },
        ]);
        grouping.handleGroupsBatch.mockResolvedValue([
            { inputIndex: 0, result: { id: 'group-id', isNew: false, isRegression: false, status: 'OPEN', regressionCount: 0 } },
            { inputIndex: 1, result: { id: 'group-id', isNew: false, isRegression: false, status: 'OPEN', regressionCount: 0 } },
        ]);
        const result = await service.ingestBatch(client, [
            {
                groupParams: { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
                eventRecord: first,
            },
            {
                groupParams: { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash-2', eventId: 'evt-2', severity: 'error' },
                eventRecord: second,
            },
        ]);
        expect(result.inserted).toBe(2);
        expect(errors.insertManyIfNew).toHaveBeenCalledTimes(1);
        expect(errors.insertIfNew).not.toHaveBeenCalled();
        expect(grouping.handleGroupsBatch).toHaveBeenCalledTimes(1);
        expect(grouping.handleGroupsBatch).toHaveBeenCalledWith(client, [
            expect.objectContaining({ fingerprint: 'hash', inputIndex: 0 }),
            expect.objectContaining({ fingerprint: 'hash-2', inputIndex: 1 }),
        ]);
        expect(grouping.handleGroup).not.toHaveBeenCalled();
        expect(errors.attachGroup).not.toHaveBeenCalled();
        expect(errors.attachGroups).toHaveBeenCalledWith(client, [
            {
                organizationId: first.organization_id,
                eventId: first.event_id,
                occurredAt: first.occurred_at,
                groupId: 'group-id',
            },
            {
                organizationId: second.organization_id,
                eventId: second.event_id,
                occurredAt: second.occurred_at,
                groupId: 'group-id',
            },
        ]);
        expect(metrics.recordStage).toHaveBeenCalledWith('error_bulk_insert', 'error', expect.any(Number));
        expect(metrics.recordStage).toHaveBeenCalledWith('error_batch_loop', 'error', expect.any(Number));
        expect(metrics.recordStage).toHaveBeenCalledWith('error_group_attach', 'error', expect.any(Number));
    });
    it('groups confirmed writer inserts without a second insert or premature domain publication', async () => {
        const record = event();
        grouping.handleGroupsBatch.mockResolvedValue([
            { inputIndex: 0, result: { id: 'group-id', isNew: true, isRegression: false, status: 'OPEN' } },
        ]);
        const result = await service.ingestBatch(client, [{
                groupParams: { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
                eventRecord: record,
            }], true);
        expect(errors.insertManyIfNew).not.toHaveBeenCalled();
        expect(grouping.handleGroupsBatch).toHaveBeenCalledTimes(1);
        expect(errors.attachGroups).toHaveBeenCalledWith(client, [{
                organizationId: 'org-1', eventId: 'evt-1', occurredAt: record.occurred_at, groupId: 'group-id',
            }]);
        expect(result.inserted).toBe(1);
        expect(result.domainEvents).toHaveLength(1);
        expect(domainEventBus.publish).not.toHaveBeenCalled();
    });
    it('does not group duplicate rows skipped by the bulk insert', async () => {
        const first = event();
        const duplicate = { ...event(), id: '2' };
        errors.insertManyIfNew.mockResolvedValue([
            {
                id: 'event-row-1',
                organizationId: first.organization_id,
                eventId: first.event_id,
                occurredAt: first.occurred_at,
            },
        ]);
        grouping.handleGroupsBatch.mockResolvedValue([
            { inputIndex: 0, result: { id: 'group-id', isNew: false, isRegression: false, status: 'OPEN', regressionCount: 0 } },
        ]);
        const result = await service.ingestBatch(client, [
            {
                groupParams: { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
                eventRecord: first,
            },
            {
                groupParams: { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
                eventRecord: duplicate,
            },
        ]);
        expect(result.inserted).toBe(1);
        expect(grouping.handleGroupsBatch).toHaveBeenCalledTimes(1);
        expect(grouping.handleGroup).not.toHaveBeenCalled();
        expect(errors.attachGroup).not.toHaveBeenCalled();
        expect(errors.attachGroups).toHaveBeenCalledTimes(1);
        expect(metrics.recordErrorDuplicate).toHaveBeenCalledTimes(1);
    });
    it('falls back to per-row grouping when batch grouping reports merged groups', async () => {
        const first = event();
        const second = { ...event(), id: '2', event_id: 'evt-2', fingerprint: 'hash-2' };
        errors.insertManyIfNew.mockResolvedValue([
            {
                id: 'event-row-1',
                organizationId: first.organization_id,
                eventId: first.event_id,
                occurredAt: first.occurred_at,
            },
            {
                id: 'event-row-2',
                organizationId: second.organization_id,
                eventId: second.event_id,
                occurredAt: second.occurred_at,
            },
        ]);
        grouping.handleGroupsBatch.mockRejectedValue(new Error('BULK_ERROR_GROUP_MERGED_GROUP_FALLBACK_REQUIRED'));
        grouping.handleGroup
            .mockResolvedValueOnce({ id: 'group-1', isNew: false, isRegression: false, status: 'OPEN', regressionCount: 0 })
            .mockResolvedValueOnce({ id: 'group-2', isNew: false, isRegression: true, status: 'OPEN', regressionCount: 1 });
        const result = await service.ingestBatch(client, [
            {
                groupParams: { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
                eventRecord: first,
            },
            {
                groupParams: { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash-2', eventId: 'evt-2', severity: 'error' },
                eventRecord: second,
            },
        ]);
        expect(result.inserted).toBe(2);
        expect(grouping.handleGroupsBatch).toHaveBeenCalledTimes(1);
        expect(grouping.handleGroup).toHaveBeenCalledTimes(2);
        expect(errors.attachGroups).toHaveBeenCalledWith(client, [
            {
                organizationId: first.organization_id,
                eventId: first.event_id,
                occurredAt: first.occurred_at,
                groupId: 'group-1',
            },
            {
                organizationId: second.organization_id,
                eventId: second.event_id,
                occurredAt: second.occurred_at,
                groupId: 'group-2',
            },
        ]);
        expect(metrics.recordErrorGroup).toHaveBeenCalledWith(false, true);
    });
});
//# sourceMappingURL=error-ingestion.service.test.js.map