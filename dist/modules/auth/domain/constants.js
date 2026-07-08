/**
 * Auth domain constants (no env / infrastructure imports).
 * Keeps Zod schemas testable without bootstrapping the full application config.
 */
/** Backup codes: 10 random bytes → 20 hex characters (80 bits of entropy). */
export const BACKUP_CODE_HEX_LENGTH = 20;
export const BACKUP_CODE_HEX_REGEX = /^[a-fA-F0-9]{20}$/;
/** Trusted device fingerprint validity (days). */
export const TRUSTED_DEVICE_TTL_DAYS = 30;
// Extracted from utils.ts
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const REMEMBER_ME_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
export const ABSOLUTE_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MFA_LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60;
export const STEP_UP_CHALLENGE_TTL_SECONDS = 5 * 60;
export const STEP_UP_FRESHNESS_TTL_SECONDS = 5 * 60;
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
export const MFA_DISABLE_TOKEN_TTL_SECONDS = 30 * 60;
export const REFRESH_GRACE_WINDOW_MS = 30 * 1000;
export const ACCOUNT_UNLOCK_TTL_SECONDS = 60 * 60;
export const ACCOUNT_DELETION_GRACE_SECONDS = 7 * 24 * 60 * 60;
export const ACCOUNT_DELETION_TOKEN_TTL_SECONDS = 60 * 60;
export const EMAIL_FLOW_TOKEN_BYTES = 48;
export function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
export function buildPasswordHistory(currentHistory, currentPasswordHash) {
    const history = Array.isArray(currentHistory) ? currentHistory.filter((entry) => typeof entry === 'string') : [];
    const ordered = [currentPasswordHash, ...history].filter((entry) => Boolean(entry));
    const seen = new Set();
    const uniq = [];
    for (const h of ordered) {
        if (!seen.has(h)) {
            seen.add(h);
            uniq.push(h);
        }
    }
    return uniq.slice(0, 5);
}
export function lockoutDurationSeconds(failedAttempts) {
    if (failedAttempts < 5)
        return 0;
    if (failedAttempts < 7)
        return 60;
    if (failedAttempts < 9)
        return 5 * 60;
    if (failedAttempts < 11)
        return 15 * 60;
    return 60 * 60;
}
//# sourceMappingURL=constants.js.map