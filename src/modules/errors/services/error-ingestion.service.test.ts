import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorIngestionService } from './error-ingestion.service.js';
import type { Pool, PoolClient } from 'pg';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';

function event() {
  return {
    id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-1',
    fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error',
    occurred_at: new Date(), timestamp: new Date(), payload: {},
  };
}

describe('ErrorIngestionService', () => {
  let service: ErrorIngestionService;
  let pool: Pool;
  let client: PoolClient;
  let grouping: { handleGroup: ReturnType<typeof vi.fn> };
  let errors: { insertIfNew: ReturnType<typeof vi.fn>; attachGroup: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() } as unknown as PoolClient;
    pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    grouping = { handleGroup: vi.fn() };
    errors = { insertIfNew: vi.fn(), attachGroup: vi.fn() };
    service = new ErrorIngestionService(pool, grouping as never, errors as never);
    vi.spyOn(domainEventBus, 'publish').mockImplementation(() => {});
  });

  it('inserts the event before grouping and commits the group association', async () => {
    errors.insertIfNew.mockResolvedValue({ inserted: true, id: 'event-row' });
    grouping.handleGroup.mockResolvedValue({ id: 'group-id', isNew: true, isRegression: false, status: 'OPEN', regressionCount: 0 });

    await service.ingestError(
      { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
      event(),
    );

    expect(errors.insertIfNew).toHaveBeenCalled();
    expect(grouping.handleGroup).toHaveBeenCalled();
    expect(errors.attachGroup).toHaveBeenCalledWith(client, 'org-1', 'evt-1', expect.any(Date), 'group-id');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(domainEventBus.publish).toHaveBeenCalledWith('ErrorGroupCreated', expect.any(Object));
  });

  it('does not mutate grouping or publish events for duplicate retries', async () => {
    errors.insertIfNew.mockResolvedValue({ inserted: false, id: null });

    await service.ingestError(
      { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
      event(),
    );

    expect(grouping.handleGroup).not.toHaveBeenCalled();
    expect(errors.attachGroup).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(domainEventBus.publish).not.toHaveBeenCalled();
  });

  it('rolls back when grouping fails after a new event insert', async () => {
    errors.insertIfNew.mockResolvedValue({ inserted: true, id: 'event-row' });
    grouping.handleGroup.mockRejectedValue(new Error('DB Error'));

    await expect(service.ingestError(
      { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
      event(),
    )).rejects.toThrow('DB Error');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
