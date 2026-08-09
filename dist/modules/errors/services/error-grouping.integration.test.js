import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorIngestionService } from './error-ingestion.service.js';
import { ErrorGroupingService } from './error-grouping.service.js';
import { ErrorGroupRepository } from '../repositories/error-group.repository.js';
import { ErrorRepository } from '../repositories/error.repository.js';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';
describe('Error Grouping System Integration', () => {
    let service;
    let pool;
    let client;
    beforeEach(() => {
        client = { query: vi.fn(), release: vi.fn() };
        pool = { connect: vi.fn().mockResolvedValue(client) };
        const groupRepo = new ErrorGroupRepository(pool);
        const errorRepo = new ErrorRepository(pool);
        service = new ErrorIngestionService(pool, new ErrorGroupingService(groupRepo), errorRepo);
        vi.spyOn(domainEventBus, 'publish').mockImplementation(() => { });
    });
    it('uses event-first deduplication before group lookup', async () => {
        client.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: 'event-row' }] })
            .mockResolvedValueOnce({ rows: [{ id: 'group-id' }] })
            .mockResolvedValue({ rows: [] });
        await service.ingestError({ organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' }, { id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-1', fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error', occurred_at: new Date(), payload: {} });
        const calls = client.query.mock.calls.map(([query]) => String(query));
        expect(calls[1]).toContain('INSERT INTO events_errors');
        expect(calls[2]).toContain('INSERT INTO error_groups');
    });
    it('does not run grouping for a duplicate event', async () => {
        client.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });
        await service.ingestError({ organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' }, { id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-1', fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error', occurred_at: new Date(), payload: {} });
        const calls = client.query.mock.calls.map(([query]) => String(query));
        expect(calls.some((query) => query.includes('INSERT INTO error_groups'))).toBe(false);
        expect(calls).toContain('COMMIT');
    });
});
//# sourceMappingURL=error-grouping.integration.test.js.map