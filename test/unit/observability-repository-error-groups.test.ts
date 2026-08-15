import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logQuery } = vi.hoisted(() => ({
  logQuery: vi.fn(),
}));

vi.mock('../../src/config/log-database.js', () => ({
  logDB: { queryWithRetry: logQuery },
}));

import { ObservabilityRepository } from '../../src/modules/observability/repository.js';

describe('ObservabilityRepository error group public IDs', () => {
  beforeEach(() => {
    logQuery.mockReset();
  });

  it('resolves latest event IDs by joining error_groups instead of reading a denormalized events_errors column', async () => {
    logQuery.mockResolvedValue({
      rows: [{
        error_group_id: '11111111-1111-4111-8111-111111111111',
        error_group_public_id: 'ISS-000000001',
        public_id: 'ERR-000000001',
      }],
    });

    const result = await new ObservabilityRepository().fetchLatestEventPublicIdMap({
      organizationId: '22222222-2222-4222-8222-222222222222',
      projectId: '33333333-3333-4333-8333-333333333333',
    } as any, ['ISS-000000001']);

    const sql = logQuery.mock.calls[0]![0] as string;
    expect(sql).toContain('FROM events_errors e');
    expect(sql).toContain('LEFT JOIN error_groups eg');
    expect(sql).toContain('eg.public_id AS error_group_public_id');
    expect(sql).toContain('eg.public_id = ANY($2::text[])');
    expect(sql).not.toContain('OR error_group_public_id = ANY');
    expect(result.get('ISS-000000001')).toBe('ERR-000000001');
  });
});
