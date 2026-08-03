import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorGroupingService } from './error-grouping.service.js';
import { ErrorGroupRepository } from '../repositories/error-group.repository.js';
describe('ErrorGroupingService', () => {
    let errorGroupingService;
    let mockRepo;
    let mockClient;
    beforeEach(() => {
        mockRepo = {
            upsertGroup: vi.fn(),
            findByFingerprint: vi.fn(),
            resolve: vi.fn(),
            ignore: vi.fn(),
            assign: vi.fn()
        };
        errorGroupingService = new ErrorGroupingService(mockRepo);
        mockClient = {};
    });
    it('should create or find group successfully', async () => {
        vi.mocked(mockRepo.upsertGroup).mockResolvedValue({ id: 'group-uuid', isNew: true, status: 'OPEN', isRegression: false });
        const result = await errorGroupingService.handleGroup(mockClient, {
            projectId: 'proj-1',
            fingerprint: 'hash',
            eventId: 'evt-1',
            severity: 'error'
        });
        expect(result).toEqual({ id: 'group-uuid', isNew: true, status: 'OPEN', isRegression: false });
        expect(mockRepo.upsertGroup).toHaveBeenCalledWith(mockClient, expect.objectContaining({
            projectId: 'proj-1',
            fingerprint: 'hash'
        }));
    });
});
//# sourceMappingURL=error-grouping.service.test.js.map