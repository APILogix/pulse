/**
 * Organization-aware auth policy resolution for login and session refresh.
 *
 * Reads org settings for all active memberships of a user. The strictest
 * applicable policy wins (any org enforcing MFA/SSO applies globally for
 * that user while they remain a member).
 */
import * as repository from './repository.js';
import { AuthError, AuthErrorCodes } from './types.js';
import type { MfaPolicy, MFAType, User } from './types.js';

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

// ============================================================================
// Organization MFA policy (migration 005)
// ============================================================================

/** Platform defaults applied when a user belongs to no organization. */
const DEFAULT_MFA_POLICY: MfaPolicy = {
  mfa_required: false,
  allowed_methods: ['totp', 'email', 'hardware_key', 'backup_codes'],
  primary_method_preference: null,
  backup_codes_required: true,
  grace_period_days: 7,
  max_devices_per_user: 10,
  allow_sms_fallback: false,
  allow_email_fallback: true,
  remember_device_days: 30,
};

// backup_codes is a fallback/recovery method, not a user-selectable primary
// method, so it is never blocked by an org's allowed-method list.
const ALWAYS_ALLOWED_METHODS: ReadonlySet<MFAType> = new Set(['backup_codes']);

function intersectMethods(a: MFAType[], b: Set<MFAType>): MFAType[] {
  return a.filter((m) => b.has(m) || ALWAYS_ALLOWED_METHODS.has(m));
}

/**
 * Resolve the effective MFA policy for a user across every active org
 * membership. "Strictest wins": MFA is required if any org requires it, a
 * method is allowed only if every org allows it, and numeric caps take the
 * most restrictive (minimum) value. A user with no orgs gets platform defaults.
 */
export async function getEffectiveMfaPolicy(userId: string): Promise<MfaPolicy> {
  const orgPolicies = await repository.listOrgAuthPoliciesForUser(userId);
  if (orgPolicies.length === 0) {
    return { ...DEFAULT_MFA_POLICY };
  }

  let allowed: MFAType[] = orgPolicies[0]!.mfa_allowed_methods as MFAType[];
  for (let i = 1; i < orgPolicies.length; i++) {
    const next = new Set(orgPolicies[i]!.mfa_allowed_methods as MFAType[]);
    allowed = intersectMethods(allowed, next);
  }
  // Guarantee recovery is always possible.
  if (!allowed.includes('backup_codes')) {
    allowed = [...allowed, 'backup_codes'];
  }

  const preference =
    orgPolicies.find((p) => p.mfa_primary_method_preference)
      ?.mfa_primary_method_preference ?? null;

  return {
    mfa_required: orgPolicies.some((p) => p.enforce_mfa),
    allowed_methods: allowed,
    primary_method_preference: preference as MFAType | null,
    backup_codes_required: orgPolicies.some((p) => p.mfa_backup_codes_required),
    grace_period_days: Math.min(...orgPolicies.map((p) => p.mfa_grace_period_days)),
    max_devices_per_user: Math.min(
      ...orgPolicies.map((p) => p.mfa_max_devices_per_user),
    ),
    // Fallback is allowed only when every org permits it.
    allow_sms_fallback: orgPolicies.every((p) => p.mfa_allow_sms_fallback),
    allow_email_fallback: orgPolicies.every((p) => p.mfa_allow_email_fallback),
    remember_device_days: Math.min(
      ...orgPolicies.map((p) => p.mfa_remember_device_days),
    ),
  };
}

/**
 * Enforce org MFA policy before enrolling a new device: the method must be
 * permitted and the user must be under the per-user device cap. Call this at
 * the start of every enrollment flow (TOTP, email, SMS, WebAuthn/passkey).
 */
export async function assertMfaEnrollmentAllowed(
  userId: string,
  deviceType: MFAType,
  currentActiveDeviceCount: number,
): Promise<MfaPolicy> {
  const policy = await getEffectiveMfaPolicy(userId);

  if (!policy.allowed_methods.includes(deviceType)) {
    throw new AuthError(
      'This MFA method is not allowed by your organization',
      AuthErrorCodes.VALIDATION_ERROR,
      400,
      { allowed_methods: policy.allowed_methods },
    );
  }

  if (currentActiveDeviceCount >= policy.max_devices_per_user) {
    throw new AuthError(
      `Maximum ${policy.max_devices_per_user} MFA devices allowed`,
      AuthErrorCodes.VALIDATION_ERROR,
      400,
    );
  }

  return policy;
}
