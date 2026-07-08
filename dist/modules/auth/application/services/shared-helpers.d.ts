import * as OTPAuth from 'otpauth';
import { type MFADevice, type MFAType, type User, type UserProfile } from '../../domain/types.js';
export declare const SESSION_CONFIG: {
    MAX_ACTIVE_SESSIONS: number;
};
export declare const TOTP_CONFIG: {
    algorithm: "SHA1";
    digits: number;
    period: number;
    window: number;
};
export declare const EMAIL_MFA_OTP_TTL_SECONDS: number;
export declare const EMAIL_MFA_OTP_DIGITS = 6;
export declare const GENERIC_PASSWORD_RESET_MESSAGE = "If the email exists, a password reset link has been sent";
export declare const GENERIC_VERIFICATION_MESSAGE = "If the account exists and is not verified, a verification email has been sent";
export declare const GENERIC_REGISTRATION_MESSAGE = "Account creation request received. Check your email to continue.";
export declare const randomBytesAsync: (arg1: number) => Promise<NonSharedBuffer>;
export declare function looksLikeRawUserAgent(value: string | null | undefined): boolean;
export declare function getSessionDeviceName(session: {
    device_name: string | null;
    device_type: string | null;
    user_agent?: string | null;
}): string;
/**
 * Backup codes: 10 random hex codes (20 hex chars = 80 bits each), shown
 * once. Persisted as bcrypt hashes (saltRounds=10) to resist rainbow-table
 * attacks if the DB is ever leaked. 80 bits of raw entropy still makes
 * online brute-force infeasible.
 */
export declare function generateBackupCodes(): Promise<{
    plain: string[];
    hashed: string[];
}>;
export declare function verifyBackupCodeHash(plain: string, hashed: string): boolean;
export declare function emailToHash(email: string): string;
export declare function toUserProfile(user: User): UserProfile;
export declare function assertUserUsable(user: User): void;
export declare function getUserPasswordHashes(user: User): string[];
export declare function ensurePasswordNotReused(user: User, newPassword: string): Promise<void>;
/**
 * Mark every active access token issued for a user as dead. The middleware
 * compares the JWT iat against the cutoff; tokens issued at or before the
 * cutoff are rejected.
 */
export declare function markAllUserTokensRevoked(userId: string): void;
/** Revoke every active session for a user AND blacklist every in-flight token. */
export declare function revokeAllSessionsAndTokens(userId: string, reason: string): Promise<number>;
/**
 * Blacklist the access tokens of every OTHER active session for the user
 * (per-session entry in the LRU). Critically does NOT blacklist the caller's
 * current session token.
 */
export declare function blacklistOtherUserSessionTokens(userId: string, currentSessionId: string): Promise<void>;
/** Mask an email for display hints: "jane.doe@example.com" -> "j•••@example.com". */
export declare function maskEmailForHint(email: string): string;
/**
 * Build the masked "try another way" display hint for a device. TOTP and
 * hardware keys fall back to the user-chosen device name; email/SMS are masked.
 */
export declare function buildMfaDisplayHint(deviceType: MFAType, deviceName: string, opts?: {
    email?: string | null;
}): string;
export declare function buildTotp(secretBase32: string, label?: string): OTPAuth.TOTP;
export declare function verifyTotpDeviceCode(device: MFADevice, code: string): boolean;
export declare function consumeBackupCode(userId: string, code: string): Promise<boolean>;
//# sourceMappingURL=shared-helpers.d.ts.map