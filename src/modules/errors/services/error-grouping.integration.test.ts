import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorIngestionService } from './error-ingestion.service.js';
import { ErrorGroupingService } from './error-grouping.service.js';
import { ErrorGroupRepository } from '../repositories/error-group.repository.js';
import { ErrorRepository } from '../repositories/error.repository.js';
import type { Pool, PoolClient } from 'pg';
import { domainEventBus } from '../../../shared/events/domain-event-bus.js';

describe('Error Grouping System Integration', () => {
  let service: ErrorIngestionService;
  let pool: Pool;
  let client: PoolClient;

  beforeEach(() => {
    client = { query: vi.fn(), release: vi.fn() } as unknown as PoolClient;
    pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const groupRepo = new ErrorGroupRepository(pool);
    const errorRepo = new ErrorRepository(pool);
    service = new ErrorIngestionService(pool, new ErrorGroupingService(groupRepo), errorRepo);
    vi.spyOn(domainEventBus, 'publish').mockImplementation(() => {});
  });

  it('uses event-first deduplication before group lookup', async () => {
    (client.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'event-row' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'group-id' }] })
      .mockResolvedValue({ rowCount: 0, rows: [] });

    await service.ingestError(
      { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
      { id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-1', fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error', occurred_at: new Date(), payload: {} },
    );

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls.map(([query]) => String(query));
    expect(calls[1]).toContain('INSERT INTO events_errors');
    expect(calls[2]).toContain('INSERT INTO error_groups');
  });

  it('does not run grouping for a duplicate event', async () => {
    (client.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await service.ingestError(
      { organizationId: 'org-1', projectId: 'proj-1', fingerprint: 'hash', eventId: 'evt-1', severity: 'error' },
      { id: '1', organization_id: 'org-1', project_id: 'proj-1', event_id: 'evt-1', fingerprint: 'hash', message: 'msg', error_name: 'Error', severity: 'error', occurred_at: new Date(), payload: {} },
    );

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls.map(([query]) => String(query));
    expect(calls.some((query) => query.includes('INSERT INTO error_groups'))).toBe(false);
    expect(calls).toContain('COMMIT');
  });
});
