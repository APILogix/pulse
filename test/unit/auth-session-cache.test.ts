import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCachedAuthSession,
  setCachedAuthSession,
  invalidateCachedAuthSession,
  authSessionCache,
} from '../../src/modules/auth/infrastructure/cache/auth.cache.js';

describe('Tier 2.3: Session + User Cache on Auth (30s TTL in Redis & L1)', () => {
  const sessionId = 'session_test_abc123';
  const userId = 'user_test_xyz789';

  const mockRecord: any = {
    session_id: sessionId,
    session_user_id: userId,
    session_status: 'active',
    session_expires_at: new Date(Date.now() + 3600_000),
    user_id: userId,
    user_email: 'tester@example.com',
    user_status: 'active',
    user_is_admin: false,
    user_deleted_at: null,
    user_current_org_id: 'org_test_1',
  };

  beforeEach(() => {
    authSessionCache.clear();
    vi.restoreAllMocks();
  });

  it('Cache stores session and user record for 30s', async () => {
    expect(authSessionCache).toBeDefined();
    expect(authSessionCache.ttl).toBe(30_000);

    // Initial cache miss
    const cachedBefore = await getCachedAuthSession(sessionId);
    expect(cachedBefore).toBeNull();

    // Cache the verified auth session
    await setCachedAuthSession(sessionId, mockRecord, 30);

    // Subsequent retrieval hits cache
    const cachedAfter = await getCachedAuthSession(sessionId);
    expect(cachedAfter).not.toBeNull();
    expect(cachedAfter?.user_email).toBe('tester@example.com');
  });

  it('50 requests in 30s make 0 auth DB queries after the first', async () => {
    const mockFindSessionAndUserById = vi.fn().mockResolvedValue(mockRecord);

    const resolveAuthSession = async (sId: string) => {
      let record = await getCachedAuthSession(sId);
      if (!record) {
        record = await mockFindSessionAndUserById(sId);
        if (record) {
          await setCachedAuthSession(sId, record, 30);
        }
      }
      return record;
    };

    // Execute 50 consecutive requests within 30s
    for (let i = 0; i < 50; i++) {
      const rec = await resolveAuthSession(sessionId);
      expect(rec?.user_id).toBe(userId);
    }

    // CRITICAL: Database must have been queried exactly ONCE across all 50 requests
    expect(mockFindSessionAndUserById).toHaveBeenCalledTimes(1);
  });

  it('Invalidates cached session immediately on logout or password change', async () => {
    await setCachedAuthSession(sessionId, mockRecord, 30);
    expect(await getCachedAuthSession(sessionId)).not.toBeNull();

    // Logout / revocation invalidates the session
    await invalidateCachedAuthSession(sessionId);

    expect(await getCachedAuthSession(sessionId)).toBeNull();
  });
});
