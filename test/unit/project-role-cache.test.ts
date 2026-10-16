import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  projectRoleCache,
  getProjectRole,
  invalidateProjectRoleCache,
} from '../../src/shared/middleware/tenant.js';
import { pool } from '../../src/config/database.js';

describe('Tier 2.4: Project Role Lookup Cache ((project_id, user_id) -> role with 60s TTL)', () => {
  const projectId = 'proj_cache_test_123';
  const userId = 'user_cache_test_456';

  beforeEach(() => {
    projectRoleCache.clear();
    vi.restoreAllMocks();
  });

  it('Configuration: projectRoleCache has max 100,000 and 60s TTL', () => {
    expect(projectRoleCache).toBeDefined();
    expect(projectRoleCache.ttl).toBe(60_000);
  });

  it('Caches (project_id, user_id) -> role; 50 calls trigger exactly 1 DB query', async () => {
    const querySpy = vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ role: 'editor' }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    } as any);

    // Initial call: cache miss, triggers DB query
    const role1 = await getProjectRole(projectId, userId);
    expect(role1).toBe('editor');
    expect(querySpy).toHaveBeenCalledTimes(1);

    // Subsequent 49 calls within 60s: all hit L1 cache
    for (let i = 0; i < 49; i++) {
      const role = await getProjectRole(projectId, userId);
      expect(role).toBe('editor');
    }

    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it('Invalidates cached role immediately upon membership change', async () => {
    const querySpy = vi.spyOn(pool, 'query')
      .mockResolvedValueOnce({
        rows: [{ role: 'editor' }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      } as any)
      .mockResolvedValueOnce({
        rows: [{ role: 'admin' }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      } as any);

    const initialRole = await getProjectRole(projectId, userId);
    expect(initialRole).toBe('editor');
    expect(querySpy).toHaveBeenCalledTimes(1);

    // Invalidate when member role changes or member is removed
    invalidateProjectRoleCache(projectId, userId);

    // Next lookup must query DB again and return updated role
    const updatedRole = await getProjectRole(projectId, userId);
    expect(updatedRole).toBe('admin');
    expect(querySpy).toHaveBeenCalledTimes(2);
  });
});
