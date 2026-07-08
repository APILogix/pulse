/**
 * Auth domain constants (no env / infrastructure imports).
 * Keeps Zod schemas testable without bootstrapping the full application config.
 */
/** Backup codes: 10 random bytes → 20 hex characters (80 bits of entropy). */
export declare const BACKUP_CODE_HEX_LENGTH = 20;
export declare const BACKUP_CODE_HEX_REGEX: RegExp;
/** Trusted device fingerprint validity (days). */
export declare const TRUSTED_DEVICE_TTL_DAYS = 30;
export declare const ACCESS_TOKEN_TTL_SECONDS: number;
export declare const REFRESH_TOKEN_TTL_SECONDS: number;
export declare const REMEMBER_ME_REFRESH_TTL_SECONDS: number;
export declare const ABSOLUTE_SESSION_TTL_SECONDS: number;
export declare const MFA_LOGIN_CHALLENGE_TTL_SECONDS: number;
export declare const STEP_UP_CHALLENGE_TTL_SECONDS: number;
export declare const STEP_UP_FRESHNESS_TTL_SECONDS: number;
export declare const PASSWORD_RESET_TTL_SECONDS: number;
export declare const EMAIL_VERIFICATION_TTL_SECONDS: number;
export declare const MFA_DISABLE_TOKEN_TTL_SECONDS: number;
export declare const REFRESH_GRACE_WINDOW_MS: number;
export declare const ACCOUNT_UNLOCK_TTL_SECONDS: number;
export declare const ACCOUNT_DELETION_GRACE_SECONDS: number;
export declare const ACCOUNT_DELETION_TOKEN_TTL_SECONDS: number;
export declare const EMAIL_FLOW_TOKEN_BYTES = 48;
export type EmailFlowPurpose = 'email_verification' | 'password_reset' | 'mfa_disable' | 'account_unlock' | 'account_deletion';
export declare function normalizeEmail(email: string): string;
export declare function buildPasswordHistory(currentHistory: unknown, currentPasswordHash: string | null): string[];
export declare function lockoutDurationSeconds(failedAttempts: number): number;
//# sourceMappingURL=constants.d.ts.map