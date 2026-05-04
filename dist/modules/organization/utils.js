/**
 * Organization utility functions.
 *
 * Flow:
 * - Token and hash helpers support invitation security.
 * - Slug generation creates stable URL-safe organization identifiers.
 * - Billing address sanitization protects repository code from malformed JSON.
 * - Logger factory gives module-scoped diagnostics without coupling services to
 *   a concrete logging implementation.
 */
import { createHash, randomBytes } from 'crypto';
import { BillingAddressSchema } from './types.js';
export function generateInvitationToken() {
    // Invitation tokens are high-entropy plaintext values returned once; the
    // repository stores only their hash.
    return randomBytes(32).toString('hex');
}
export function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
export function generateSlug(name) {
    const base = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50);
    return base || `org-${randomBytes(3).toString('hex')}`;
}
export function sanitizeBillingAddress(value) {
    // Use the shared schema to reject malformed billing contact data instead of
    // trusting JSON stored in billing notes.
    const parsed = BillingAddressSchema.safeParse(value);
    if (!parsed.success) {
        return null;
    }
    return parsed.data;
}
export function createOrganizationLogger(context) {
    return {
        info: (message, meta) => {
            console.log(`[ORGANIZATION:${context}] ${message}`, meta ? JSON.stringify(meta) : '');
        },
        error: (message, error) => {
            console.error(`[ORGANIZATION:${context}:ERROR] ${message}`, error);
        },
        warn: (message, meta) => {
            console.warn(`[ORGANIZATION:${context}:WARN] ${message}`, meta ? JSON.stringify(meta) : '');
        },
        debug: (message, meta) => {
            if (process.env.DEBUG_BILLING === 'true') {
                console.log(`[ORGANIZATION:${context}:DEBUG] ${message}`, meta ? JSON.stringify(meta) : '');
            }
        }
    };
}
//# sourceMappingURL=utils.js.map