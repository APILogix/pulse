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
export declare function getPasswordPolicy(): PasswordPolicyPublic;
export declare function getEffectiveAuthPolicy(userId: string): Promise<EffectiveAuthPolicy>;
/**
 * Enforce tenant policy immediately after primary authentication succeeds.
 */
export declare function assertLoginAllowedByOrgPolicy(user: User): Promise<void>;
/**
 * Re-check policy on refresh so revoked MFA or SSO-only policy takes effect
 * without waiting for access-token expiry.
 */
export declare function assertRefreshAllowedByOrgPolicy(user: User, sessionLastActiveAt: Date): Promise<void>;
/**
 * Resolve the effective MFA policy for a user across every active org
 * membership. "Strictest wins": MFA is required if any org requires it, a
 * method is allowed only if every org allows it, and numeric caps take the
 * most restrictive (minimum) value. A user with no orgs gets platform defaults.
 */
export declare function getEffectiveMfaPolicy(userId: string): Promise<MfaPolicy>;
/**
 * Enforce org MFA policy before enrolling a new device: the method must be
 * permitted and the user must be under the per-user device cap. Call this at
 * the start of every enrollment flow (TOTP, email, SMS, WebAuthn/passkey).
 */
export declare function assertMfaEnrollmentAllowed(userId: string, deviceType: MFAType, currentActiveDeviceCount: number): Promise<MfaPolicy>;
//# sourceMappingURL=policy.service.d.ts.map