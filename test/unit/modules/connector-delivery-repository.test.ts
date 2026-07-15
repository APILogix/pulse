import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('../../../src/config/database.js', () => ({
  pool: {
    query,
  },
}));

async function createRepository() {
  const { DeliveryRepository } = await import('../../../src/modules/connectors/delivery/delivery.repository.js');
  return new DeliveryRepository();
}

describe('DeliveryRepository attempt isolation', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('requires organization and connector ownership when listing delivery attempts', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'attempt-1',
          delivery_id: 'delivery-1',
          delivery_created_at: new Date('2026-07-14T10:00:00.000Z'),
          attempt_number: 1,
          status: 'failed',
          http_status: 500,
          error_code: 'server_error',
          error_message: 'provider failed',
          response: { ok: false },
          duration_ms: 123,
          attempted_at: new Date('2026-07-14T10:00:01.000Z'),
        }],
      });

    const repository = await createRepository();

    const result = await repository.listAttempts('org-1', 'connector-1', 'delivery-1', {
      limit: 25,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]![0]).toContain('d.connector_id=$3');
    expect(query.mock.calls[0]![1]).toEqual(['delivery-1', 'org-1', 'connector-1']);
    expect(query.mock.calls[1]![0]).toContain('d.connector_id=$3');
    expect(query.mock.calls[1]![1]).toEqual(['delivery-1', 'org-1', 'connector-1', 25, 0]);
  });

  it('records dead-letter audit rows as system actions', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const repository = await createRepository();

    await repository.insertDeadLetter({
      originalDeliveryId: 'delivery-1',
      organizationId: 'org-1',
      connectorId: 'connector-1',
      failureReason: 'Provider unavailable',
      failureCategory: 'server_error',
      errorStack: null,
      originalPayload: { title: 'CPU high' },
      retryAttempts: 4,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain('actor_type');
    expect(query.mock.calls[0]![0]).toContain("'system'");
  });

  it('resets exhausted delivery attempt state for manual retry', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        id: 'delivery-1',
        organization_id: 'org-1',
        connector_id: 'connector-1',
        status: 'retrying',
        attempts: 0,
        retry_count: 0,
        failed_at: null,
        error_message: null,
        error_details: null,
      }],
    });

    const repository = await createRepository();

    const row = await repository.retryDelivery('org-1', 'delivery-1');

    expect(row?.attempts).toBe(0);
    expect(row?.retry_count).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain('attempts=0');
    expect(query.mock.calls[0]![0]).toContain('retry_count=0');
    expect(query.mock.calls[0]![0]).toContain('failed_at=NULL');
    expect(query.mock.calls[0]![0]).toContain("status IN ('failed','retrying')");
    expect(query.mock.calls[0]![1]).toEqual(['delivery-1', 'org-1']);
  });
});
