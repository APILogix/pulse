import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logAudit, flushAuditLogs } from '../../src/shared/middleware/audit-logger.js';
import { pool } from '../../src/config/database.js';

describe('Audit Logger Micro-Batching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('batches multiple audit entries into a single multi-row insert', async () => {
    const querySpy = vi.spyOn(pool, 'query').mockResolvedValue({ rowCount: 2 } as any);

    logAudit({
      user_id: '11111111-1111-1111-1111-111111111111',
      org_id: '22222222-2222-2222-2222-222222222222',
      action: 'user.login',
      resource_type: 'user',
      resource_id: '11111111-1111-1111-1111-111111111111',
      ip_address: '127.0.0.1',
      request_id: 'req-1',
    });

    logAudit({
      user_id: '11111111-1111-1111-1111-111111111111',
      org_id: '22222222-2222-2222-2222-222222222222',
      action: 'user.mfa_verify',
      resource_type: 'user',
      resource_id: '11111111-1111-1111-1111-111111111111',
      ip_address: '127.0.0.1',
      request_id: 'req-2',
    });

    await flushAuditLogs();

    expect(querySpy).toHaveBeenCalledTimes(1);
    const [sql, values] = querySpy.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(sql).toContain('VALUES ($1, $2');
    expect(sql).toContain('$13, $14'); // Second row parameters start at $13
    expect(values).toHaveLength(24); // 12 columns * 2 rows
    expect(values[2]).toBe('user.login');
    expect(values[14]).toBe('user.mfa_verify');
  });

  it('handles single entry as single-row insert', async () => {
    const querySpy = vi.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 } as any);

    logAudit({
      user_id: null,
      org_id: null,
      action: 'system.startup',
      resource_type: 'system',
      resource_id: null,
      ip_address: '127.0.0.1',
      request_id: 'req-single',
    });

    await flushAuditLogs();

    expect(querySpy).toHaveBeenCalledTimes(1);
    const [sql, values] = querySpy.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())');
    expect(values).toHaveLength(12);
    expect(values[2]).toBe('system.startup');
  });
});
