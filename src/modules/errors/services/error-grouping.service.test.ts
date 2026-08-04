import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorGroupingService } from './error-grouping.service.js';
import { ErrorGroupRepository } from '../repositories/error-group.repository.js';
import type { PoolClient } from 'pg';

describe('ErrorGroupingService', () => {
  let errorGroupingService: ErrorGroupingService;
  let mockRepo: ErrorGroupRepository;
  let mockClient: PoolClient;

  beforeEach(() => {
    mockRepo = {
      upsertGroup: vi.fn(),
      findByFingerprint: vi.fn(),
      resolve: vi.fn(),
      ignore: vi.fn(),
      assign: vi.fn()
    } as unknown as ErrorGroupRepository;
    
    errorGroupingService = new ErrorGroupingService(mockRepo);
    mockClient = {} as PoolClient;
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
