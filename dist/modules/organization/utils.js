/**
 * Organization utility functions.
 *
 * - Token and hash helpers for invitation / API key / SCIM security.
 * - Slug generation creates stable URL-safe organization identifiers.
 * - Logger factory for module-scoped diagnostics.
 */
import { createHash, randomBytes } from "crypto";
/** Generate a 64-character hex token for invitations, API keys, SCIM etc. */
export function generateToken() {
    return randomBytes(32).toString("hex");
}
/** Alias preserved for backward compatibility. */
export const generateInvitationToken = generateToken;
/** SHA-256 hash a plaintext token for secure storage. */
export function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
/** Generate a URL-safe slug from an organization name. */
export function generateSlug(name) {
    const base = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 50);
    return base || `org-${randomBytes(3).toString("hex")}`;
}
/**
 * Generate a prefixed API key.
 * Returns { rawKey, keyPrefix, hashedKey }.
 * The raw key is returned to the caller ONCE; only the hash is stored.
 */
export function generateApiKey(orgSlug) {
    const prefix = `smk_${orgSlug.substring(0, 8)}_`;
    const secret = randomBytes(24).toString("base64url");
    const rawKey = `${prefix}${secret}`;
    const hashedKey = hashToken(rawKey);
    return { rawKey, keyPrefix: prefix, hashedKey };
}
/** Generate a SCIM bearer token. Returns { rawToken, hashedToken }. */
export function generateScimToken() {
    const rawToken = `scim_${randomBytes(32).toString("base64url")}`;
    const hashedToken = hashToken(rawToken);
    return { rawToken, hashedToken };
}
/** Generate a slug from a name for environments. */
export function generateEnvSlug(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 100);
}
/** Compute changed fields between two objects for audit trail. */
export function computeChangedFields(oldValues, newValues) {
    const changed = [];
    for (const key of new Set([...Object.keys(oldValues), ...Object.keys(newValues)])) {
        if (oldValues[key] !== newValues[key]) {
            changed.push(key);
        }
    }
    return changed;
}
export function createOrganizationLogger(context) {
    return {
        info: (message, meta) => {
            console.log(`[ORGANIZATION:${context}] ${message}`, meta ? JSON.stringify(meta) : "");
        },
        error: (message, error) => {
            console.error(`[ORGANIZATION:${context}:ERROR] ${message}`, error);
        },
        warn: (message, meta) => {
            console.warn(`[ORGANIZATION:${context}:WARN] ${message}`, meta ? JSON.stringify(meta) : "");
        },
    };
}
//# sourceMappingURL=utils.js.map