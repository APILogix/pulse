import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorIngestionService } from './error-ingestion.service.js';
import { ErrorGroupingService } from './error-grouping.service.js';
import { ErrorGroupRepository } from '../repositories/error-group.repository.js';
import { ErrorRepository } from '../repositories/error.repository.js';
import type { Pool, PoolClient } from 'pg';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';

describe('Error Grouping System Integration', () => {
  let errorIngestionService: ErrorIngestionService;
  let mockPool: Pool;
  let mockClient: PoolClient;
  let errorGroupRepo: ErrorGroupRepository;
  let errorRepo: ErrorRepository;

  beforeEach(() => {
    mockClient = {
      query: vi.fn(),
      release: vi.fn()
    } as unknown as PoolClient;

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient)
    } as unknown as Pool;

    errorGroupRepo = new ErrorGroupRepository(mockPool);
    errorRepo = new ErrorRepository(mockPool);
    const errorGroupingService = new ErrorGroupingService(errorGroupRepo);
    
    errorIngestionService = new ErrorIngestionService(mockPool, errorGroupingService, errorRepo);
    
    vi.spyOn(domainEventBus, 'publish').mockImplementation(() => {});
  });

  it('Group Creation: First occurrence creates exactly one group', async () => {
    vi.mocked(mockClient.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'new-group-id' }] }) // upsertGroup
      .mockResolvedValueOnce({ rows: [] }) // insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    await errorIngestionService.ingestError(
      { projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
      { id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-1', fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error', timestamp: new Date(), payload: {} }
    );

    const upsertCall = vi.mocked(mockClient.query).mock.calls[1][0] as string;
    expect(upsertCall).toContain('INSERT INTO error_groups');
    expect(upsertCall).toContain('ON CONFLICT (project_id, fingerprint) DO UPDATE');
  });

  it('Transactions: If event insertion fails, no orphaned group should remain', async () => {
    vi.mocked(mockClient.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'group-id' }] }) // upsertGroup
      .mockRejectedValueOnce(new Error('Insertion failed')); // insert

    await expect(errorIngestionService.ingestError(
      { projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
      { id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-1', fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error', timestamp: new Date(), payload: {} }
    )).rejects.toThrow('Insertion failed');

    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(domainEventBus.publish).not.toHaveBeenCalled();
  });

  it('Concurrency: Simulate many simultaneous ingestions with the same fingerprint', async () => {
    vi.mocked(mockClient.query)
      .mockResolvedValue({ rowCount: 1, rows: [{ id: 'concurrent-group-id', is_new: false, is_regression: false, status: 'OPEN' }] }); 
      
    // 10 concurrent requests
    const promises = Array.from({ length: 10 }).map((_, i) => 
      errorIngestionService.ingestError(
        { projectId: 'proj-1', fingerprint: 'hash', eventId: `evt-${i}`, severity: 'error' },
        { id: `${i}`, organization_id: 'org-1', project_id: 'proj-1', event_id: `evt-${i}`, fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error', timestamp: new Date(), payload: {} }
      )
    );

    await Promise.all(promises);

    expect(mockClient.query).toHaveBeenCalledTimes(10 * 4); // BEGIN, upsert, insert, COMMIT for each
    expect(domainEventBus.publish).toHaveBeenCalledTimes(10);
  });

  it('Idempotency: Duplicate event_id ignores insertion and rolls back group counter bump', async () => {
    // Clear the mocks from previous tests to observe exactly this test
    vi.mocked(mockClient.query).mockClear();
    vi.mocked(domainEventBus.publish).mockClear();

    // Setup: Return a valid group from handleGroup (simulating real DB upsert)
    vi.mocked(mockClient.query)
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'group-id', is_new: false, is_regression: false, status: 'OPEN' }] }) // Upsert Group
      .mockResolvedValueOnce({ rowCount: 0 }) // Insert Event (simulate DO NOTHING by returning 0 rows)
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await errorIngestionService.ingestError(
      { projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-dup', severity: 'error' },
      { id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-dup', fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error', timestamp: new Date(), payload: {} }
    );

    // It should rollback and NOT publish
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(domainEventBus.publish).not.toHaveBeenCalled();
  });
});
