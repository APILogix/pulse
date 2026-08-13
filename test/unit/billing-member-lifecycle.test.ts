import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MembersRepository } from '../../src/modules/organization/members/members.repository.js';
import { InvitationsRepository } from '../../src/modules/organization/invitations/invitations.repository.js';
import { quotaGuard } from '../../src/modules/billing/entitlements/quota-guard.js';
import { entitlementsService } from '../../src/modules/billing/entitlements/service.js';
import { BillingQuotaExceededError } from '../../src/modules/billing/entitlements/errors.js';

describe('Member Lifecycle & Quota Hardening', () => {
  const orgId = 'org-member-test-123';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enforces quota.members during direct member addition in MembersRepository.addMember', async () => {
    vi.spyOn(entitlementsService, 'getEffectiveIntegerFeature').mockResolvedValue(5);

    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT COUNT(*)::text AS count FROM organization_members')) {
          return { rows: [{ count: '5' }] }; // already at limit 5
        }
        if (sql.includes('INSERT INTO organization_members')) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      }),
    };

    const repo = new MembersRepository();
    vi.spyOn(repo as any, 'withTransaction').mockImplementation(async (cb: any) => cb(mockClient));
    vi.spyOn(repo, 'findMember').mockResolvedValue(null);

    await expect(
      repo.addMember(orgId, 'user-1', 'member', 'admin-1', 'api')
    ).rejects.toThrow(BillingQuotaExceededError);
  });

  it('allows member addition when live member count is within quota.members', async () => {
    vi.spyOn(entitlementsService, 'getEffectiveIntegerFeature').mockResolvedValue(10);

    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT COUNT(*)::text AS count FROM organization_members')) {
          return { rows: [{ count: '3' }] }; // 3 < 10
        }
        if (sql.includes('INSERT INTO organization_members')) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      }),
    };

    const repo = new MembersRepository();
    vi.spyOn(repo as any, 'withTransaction').mockImplementation(async (cb: any) => cb(mockClient));
    vi.spyOn(repo, 'findMember').mockResolvedValue({
      id: 'om-1',
      org_id: orgId,
      user_id: 'user-1',
      role: 'member',
      status: 'active',
      joined_at: new Date(),
      last_active_at: new Date(),
      created_at: new Date(),
      email: 'user1@example.com',
      full_name: 'User One',
      mfa_enabled: false,
    } as any);

    const member = await repo.addMember(orgId, 'user-1', 'member', 'admin-1', 'api');
    expect(member).toBeDefined();
    expect(member.user_id).toBe('user-1');
  });

  it('enforces quota.members when accepting invitations via InvitationsRepository.acceptInvitationAndAddMember', async () => {
    vi.spyOn(entitlementsService, 'getEffectiveIntegerFeature').mockResolvedValue(2);

    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('organization_invitations')) {
          return { rows: [{ id: 'inv-1', org_id: orgId, role: 'member', invited_by: 'admin-1' }] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT COUNT(*)::text AS count FROM organization_members')) {
          return { rows: [{ count: '2' }] }; // at limit 2
        }
        return { rows: [] };
      }),
    };

    const repo = new InvitationsRepository();
    vi.spyOn(repo as any, 'withTransaction').mockImplementation(async (cb: any) => cb(mockClient));

    await expect(
      repo.acceptInvitationAndAddMember('token-hash-123', 'user-2', 2)
    ).rejects.toThrow(BillingQuotaExceededError);
  });

  it('enforces quota.members when reactivating suspended or removed members', async () => {
    vi.spyOn(entitlementsService, 'getEffectiveIntegerFeature').mockResolvedValue(3);

    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT COUNT(*)::text AS count FROM organization_members')) {
          return { rows: [{ count: '3' }] }; // at limit 3
        }
        if (sql.includes('UPDATE organization_members SET status=\'active\'')) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      }),
    };

    const repo = new MembersRepository();
    vi.spyOn(repo as any, 'withTransaction').mockImplementation(async (cb: any) => cb(mockClient));

    await expect(
      repo.reactivateMember(orgId, 'user-suspended')
    ).rejects.toThrow(BillingQuotaExceededError);
  });
});
