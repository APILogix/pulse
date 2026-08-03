import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueLifecycleService, InvalidTransitionError } from './issue-lifecycle.service.js';
import type { ErrorGroupRepository } from '../repositories/error-group.repository.js';
import type { ErrorGroupHistoryRepository } from '../repositories/error-group-history.repository.js';
import type { Pool, PoolClient } from 'pg';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';

describe('IssueLifecycleService', () => {
  let issueLifecycleService: IssueLifecycleService;
  let mockPool: Pool;
  let mockClient: PoolClient;
  let errorGroupRepo: ErrorGroupRepository;
  let historyRepo: ErrorGroupHistoryRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockClient = {
      query: vi.fn(),
      release: vi.fn()
    } as unknown as PoolClient;

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient)
    } as unknown as Pool;

    errorGroupRepo = {
      resolve: vi.fn(),
      ignore: vi.fn(),
      reopen: vi.fn(),
      archive: vi.fn(),
    } as unknown as ErrorGroupRepository;
    
    historyRepo = {
      insertHistory: vi.fn()
    } as unknown as ErrorGroupHistoryRepository;
    
    issueLifecycleService = new IssueLifecycleService(mockPool, errorGroupRepo, historyRepo);
    
    vi.spyOn(domainEventBus, 'publish').mockImplementation(() => {});
  });

  it('valid transition: OPEN -> RESOLVED', async () => {
    vi.mocked(mockClient.query).mockImplementation(async (q: string) => {
      if (q.includes('SELECT')) return { rows: [{ status: 'OPEN', version: 1 }] };
      return { rows: [] };
    });

    await issueLifecycleService.resolve('proj-1', 'group-1', 'actor-1');

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(errorGroupRepo.resolve).toHaveBeenCalledWith(mockClient, 'proj-1', 'group-1');
    expect(historyRepo.insertHistory).toHaveBeenCalledWith(mockClient, expect.objectContaining({
      action: 'STATUS_CHANGED',
      oldValue: { status: 'OPEN' },
      newValue: { status: 'RESOLVED' }
    }));
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(domainEventBus.publish).toHaveBeenCalledWith('ErrorResolved', expect.objectContaining({
      projectId: 'proj-1',
      groupId: 'group-1'
    }));
  });

  it('invalid transition throws and rolls back', async () => {
    vi.mocked(mockClient.query).mockImplementation(async (q: string) => {
      if (q.includes('SELECT')) return { rows: [{ status: 'RESOLVED', version: 1 }] };
      return { rows: [] };
    });

    await expect(issueLifecycleService.ignore('proj-1', 'group-1')).rejects.toThrow(InvalidTransitionError);

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(domainEventBus.publish).not.toHaveBeenCalled();
    expect(errorGroupRepo.ignore).not.toHaveBeenCalled();
    expect(historyRepo.insertHistory).not.toHaveBeenCalled();
  });
});
