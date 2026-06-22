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
//# sourceMappingURL=policy.service.d.ts.map