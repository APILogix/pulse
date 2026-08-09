import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { AlertRuntimeRepository } from '../../src/modules/alerting/runtime/alert-runtime.repository.js';

describe('alert runtime delivery ownership', () => {
  it('requires organization-scoped status updates', async () => {
    const client = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN') return { rows: [] };
        if (sql.includes('alert-notification-delivery:')) return { rows: [] };
        if (sql.includes('WHERE id = $1 AND organization_id = $2')) return { rows: [] };
        if (sql === 'COMMIT') return { rows: [] };
        if (sql === 'ROLLBACK') return { rows: [] };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    const db = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;
    const repository = new AlertRuntimeRepository(db);

    const result = await repository.recordNotificationDelivery({
      organizationId: 'org-1',
      jobId: 'job-1',
      jobStatus: 'sent',
      attemptStatus: 'sent',
    });

    expect(result).toBe(false);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND organization_id = $2'),
      ['job-1', 'org-1'],
    );
    expect(client.release).toHaveBeenCalledOnce();
  });
});
