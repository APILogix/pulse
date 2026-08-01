import { describe, expect, it } from 'vitest';
import { toUser } from '../../../src/modules/auth/infrastructure/repositories/user.repository.js';

describe('auth user repository mapping', () => {
  it('maps database email_verified into the domain email_is_verified field', () => {
    const user = toUser({
      id: 'user_1',
      email: 'verified@example.test',
      email_hash: 'hash',
      email_verified: true,
      email_is_verified: false,
      email_verified_at: new Date('2026-08-01T00:00:00Z'),
      full_name: 'Verified User',
      avatar_url: null,
      password_hash: null,
      last_password_change: null,
      password_history: [],
      status: 'active',
      status_reason: null,
      is_admin: false,
      current_org_id: null,
      mfa_enabled: false,
      mfa_enforced_at: null,
      login_attempts: 0,
      locked_until: null,
      last_login_at: null,
      last_login_ip: null,
      last_login_user_agent: null,
      last_failed_login_at: null,
      last_failed_login_ip: null,
      timezone: 'UTC',
      locale: 'en',
      preferred_mfa_method: null,
      accepted_terms_at: null,
      accepted_terms_version: null,
      accepted_privacy_at: null,
      accepted_privacy_version: null,
      marketing_consent: false,
      marketing_consent_updated_at: null,
      data_processing_consent: true,
      suspended_at: null,
      suspended_by: null,
      deleted_at: null,
      deleted_by: null,
      deletion_reason: null,
      deletion_scheduled_at: null,
      created_at: new Date('2026-08-01T00:00:00Z'),
      updated_at: new Date('2026-08-01T00:00:00Z'),
      created_by: null,
      version: 1,
    });

    expect(user?.email_is_verified).toBe(true);
    expect(user?.email_verified_at).toEqual(new Date('2026-08-01T00:00:00Z'));
  });
});
