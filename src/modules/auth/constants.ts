/**
 * Auth domain constants (no env / infrastructure imports).
 * Keeps Zod schemas testable without bootstrapping the full application config.
 */

/** Backup codes: 10 random bytes → 20 hex characters (80 bits of entropy). */
export const BACKUP_CODE_HEX_LENGTH = 20;
export const BACKUP_CODE_HEX_REGEX = /^[a-fA-F0-9]{20}$/;

/** Trusted device fingerprint validity (days). */
export const TRUSTED_DEVICE_TTL_DAYS = 30;
