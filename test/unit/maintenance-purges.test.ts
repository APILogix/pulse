import { describe, it, expect, vi } from 'vitest';
import { AuditLogsRepository } from '../../src/modules/organization/audit-logs/audit-logs.repository.js';
import { purgeOldRevokedSessions } from '../../src/modules/auth/infrastructure/repositories/session.repository.js';

describe('Maintenance batch purges (MAINT-Q014 & MAINT-Q015)', () => {
  it('purgeExpiredAuditLogs deletes in bounded batches until fewer than batchSize rows remain', async () => {
    const mockDb = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 100 })
        .mockResolvedValueOnce({ rowCount: 42 }),
    };

    const repo = new AuditLogsRepository(mockDb as any);
    const deleted = await repo.purgeExpiredAuditLogs(100);

    expect(deleted).toBe(142);
    expect(mockDb.query).toHaveBeenCalledTimes(2);

    const firstCallSql = mockDb.query.mock.calls[0]![0] as string;
    expect(firstCallSql).toContain('DELETE FROM organization_audit_logs');
    expect(firstCallSql).toContain('WHERE id IN (');
    expect(firstCallSql).toContain('LIMIT $1');
    expect(mockDb.query.mock.calls[0]![1]).toEqual([100]);
  });

  it('purgeOldRevokedSessions deletes in bounded batches with sargable date checks', async () => {
    const mockClient = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 50 })
        .mockResolvedValueOnce({ rowCount: 10 }),
    };

    const deleted = await purgeOldRevokedSessions(30, mockClient as any, 50);

    expect(deleted).toBe(60);
    expect(mockClient.query).toHaveBeenCalledTimes(2);

    const sql = mockClient.query.mock.calls[0]![0] as string;
    expect(sql).toContain('DELETE FROM user_sessions');
    expect(sql).toContain('WHERE id IN (');
    expect(sql).toContain('LIMIT $2');
    expect(sql).toContain('terminated_at IS NOT NULL');
    expect(sql).not.toContain('COALESCE(terminated_at, expires_at)');
    expect(mockClient.query.mock.calls[0]![1]).toEqual(['30 days', 50]);
  });
});
