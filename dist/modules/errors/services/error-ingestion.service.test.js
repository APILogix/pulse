import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorIngestionService } from './error-ingestion.service.js';
import { ErrorGroupingService } from './error-grouping.service.js';
import { ErrorRepository } from '../repositories/error.repository.js';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';
describe('ErrorIngestionService', () => {
    let errorIngestionService;
    let mockPool;
    let mockClient;
    let mockGroupingService;
    let mockErrorRepo;
    beforeEach(() => {
        mockClient = {
            query: vi.fn(),
            release: vi.fn()
        };
        mockPool = {
            connect: vi.fn().mockResolvedValue(mockClient)
        };
        mockGroupingService = {
            handleGroup: vi.fn()
        };
        mockErrorRepo = {
            insert: vi.fn()
        };
        errorIngestionService = new ErrorIngestionService(mockPool, mockGroupingService, mockErrorRepo);
        vi.spyOn(domainEventBus, 'publish').mockImplementation(() => { });
    });
    it('should successfully ingest an error transactionally', async () => {
        vi.mocked(mockGroupingService.handleGroup).mockResolvedValue({ id: 'group-id', isNew: true, isRegression: false, status: 'OPEN' });
        vi.mocked(mockErrorRepo.insert).mockResolvedValue(true);
        await errorIngestionService.ingestError({ projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' }, { id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-1', fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error', timestamp: new Date(), payload: {} });
        expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
        expect(mockGroupingService.handleGroup).toHaveBeenCalled();
        expect(mockErrorRepo.insert).toHaveBeenCalled();
        expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        expect(mockClient.release).toHaveBeenCalled();
        expect(domainEventBus.publish).toHaveBeenCalledWith('ErrorGroupCreated', expect.any(Object));
    });
    it('should rollback transaction on failure', async () => {
        vi.mocked(mockGroupingService.handleGroup).mockRejectedValue(new Error('DB Error'));
        await expect(errorIngestionService.ingestError({ projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' }, { id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-1', fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error', timestamp: new Date(), payload: {} })).rejects.toThrow('DB Error');
        expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(mockClient.release).toHaveBeenCalled();
    });
});
//# sourceMappingURL=error-ingestion.service.test.js.map