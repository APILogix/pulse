/**
 * Organization-aware auth policy resolution for login and session refresh.
 *
 * Reads org settings for all active memberships of a user. The strictest
 * applicable policy wins (any org enforcing MFA/SSO applies globally for
 * that user while they remain a member).
 */
import * as repository from './repository.js';
import { AuthError, AuthErrorCodes } from './types.js';
import type { User } from './types.js';

export interface PasswordPolicyPublic {
  min_length: number;
  max_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_number: boolean;
  require_special: boolean;
  history_count: number;
}

export interface EffectiveAuthPolicy {
  enforce_mfa: boolean;
  enforce_sso: boolean;
  session_timeout_minutes: number | null;
  organization_count: number;
}

export function getPasswordPolicy(): PasswordPolicyPublic {
  return {
    min_length: 8,
    max_length: 128,
    require_uppercase: true,
    require_lowercase: true,
    require_number: true,
    require_special: true,
    history_count: 5,
  };
}

export async function getEffectiveAuthPolicy(
  userId: string,
): Promise<EffectiveAuthPolicy> {
  const orgPolicies = await repository.listOrgAuthPoliciesForUser(userId);

  const timeouts = orgPolicies
    .map((p) => p.session_timeout_minutes)
    .filter((v): v is number => typeof v === 'number' && v > 0);

  return {
    enforce_mfa: orgPolicies.some((p) => p.enforce_mfa),
    enforce_sso: orgPolicies.some((p) => p.enforce_sso),
    session_timeout_minutes:
      timeouts.length > 0 ? Math.min(...timeouts) : null,
    organization_count: orgPolicies.length,
  };
}

/**
 * Enforce tenant policy immediately after primary authentication succeeds.
 */
export async function assertLoginAllowedByOrgPolicy(user: User): Promise<void> {
  const policy = await getEffectiveAuthPolicy(user.id);

  if (policy.enforce_sso && user.password_hash) {
    throw new AuthError(
      'Your organization requires SSO sign-in. Use your company identity provider.',
      AuthErrorCodes.SSO_REQUIRED,
      403,
    );
  }

  if (policy.enforce_mfa && !user.mfa_enabled) {
    throw new AuthError(
      'Your organization requires multi-factor authentication. Enable MFA before signing in.',
      AuthErrorCodes.MFA_REQUIRED,
      403,
      { enforce_mfa: true },
    );
  }
}

/**
 * Re-check policy on refresh so revoked MFA or SSO-only policy takes effect
 * without waiting for access-token expiry.
 */
export async function assertRefreshAllowedByOrgPolicy(
  user: User,
  sessionLastActiveAt: Date,
): Promise<void> {
  const policy = await getEffectiveAuthPolicy(user.id);

  if (policy.enforce_sso && user.password_hash) {
    throw new AuthError(
      'Organization SSO policy is now in effect. Sign in again with SSO.',
      AuthErrorCodes.SSO_REQUIRED,
      403,
    );
  }

  if (policy.enforce_mfa && !user.mfa_enabled) {
    throw new AuthError(
      'Organization MFA policy is now in effect. Enable MFA and sign in again.',
      AuthErrorCodes.MFA_REQUIRED,
      403,
    );
  }

  if (policy.session_timeout_minutes) {
    const idleMs = policy.session_timeout_minutes * 60 * 1000;
    if (Date.now() - sessionLastActiveAt.getTime() > idleMs) {
      throw new AuthError(
        'Session expired due to organization idle timeout',
        AuthErrorCodes.SESSION_EXPIRED,
        401,
      );
    }
  }
}
