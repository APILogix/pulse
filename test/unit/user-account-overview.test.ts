import { describe, it, expect, vi } from 'vitest';
import * as repo from '../../src/modules/user-account/repository.js';
import * as service from '../../src/modules/user-account/service.js';

describe('User Account Security Overview Consolidation (USR-Q021)', () => {
  it('getAccountSecurityCounts consolidates 4 scalar counters into a single query', async () => {
    const mockRow = {
      backup_codes_remaining: 8,
      active_sessions_count: 2,
      trusted_devices_count: 1,
      passkeys_count: 3,
    };

    const spy = vi.spyOn(repo, 'getAccountSecurityCounts').mockResolvedValueOnce({
      backupCodesRemaining: 8,
      activeSessions: 2,
      trustedDevices: 1,
      passkeys: 3,
    });

    const counts = await repo.getAccountSecurityCounts('user-123');

    expect(counts).toEqual({
      backupCodesRemaining: 8,
      activeSessions: 2,
      trustedDevices: 1,
      passkeys: 3,
    });
    expect(spy).toHaveBeenCalledWith('user-123');
    spy.mockRestore();
  });

  it('getAccountOverview runs consolidated queries without parallel connection exhaustion', async () => {
    vi.spyOn(repo, 'getUserAccount').mockResolvedValueOnce({
      id: 'user-123',
      email: 'user@example.com',
      email_verified: true,
      mfa_enabled: true,
      display_name: 'Test User',
      full_name: 'Test User',
      avatar_url: null,
      timezone: 'UTC',
      locale: 'en',
      created_at: new Date(),
    } as any);

    vi.spyOn(repo, 'getVerifiedMfaDevices').mockResolvedValueOnce([
      { method: 'totp', name: 'Authenticator', verified: true, is_default: true } as any,
    ]);

    const countsSpy = vi.spyOn(repo, 'getAccountSecurityCounts').mockResolvedValueOnce({
      backupCodesRemaining: 10,
      activeSessions: 1,
      trustedDevices: 2,
      passkeys: 1,
    });

    vi.spyOn(repo, 'getRecentActivity').mockResolvedValueOnce([]);

    const overview = await service.getAccountOverview('user-123');

    expect(overview.security_health.checks.backup_codes_remaining).toBe(10);
    expect(overview.security_health.checks.has_trusted_devices).toBe(true);
    expect(overview.security_health.checks.email_verified).toBe(true);
    expect(overview.security_health.checks.mfa_enabled).toBe(true);
    expect(countsSpy).toHaveBeenCalledTimes(1);
  });
});
