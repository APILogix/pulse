/** Generate a 64-character hex token for invitations, API keys, SCIM etc. */
export declare function generateToken(): string;
/** Alias preserved for backward compatibility. */
export declare const generateInvitationToken: typeof generateToken;
/** SHA-256 hash a plaintext token for secure storage. */
export declare function hashToken(token: string): string;
/** Generate a URL-safe slug from an organization name. */
export declare function generateSlug(name: string): string;
/**
 * Generate a prefixed API key.
 * Returns { rawKey, keyPrefix, hashedKey }.
 * The raw key is returned to the caller ONCE; only the hash is stored.
 */
export declare function generateApiKey(orgSlug: string): {
    rawKey: string;
    keyPrefix: string;
    hashedKey: string;
};
/** Generate a SCIM bearer token. Returns { rawToken, hashedToken }. */
export declare function generateScimToken(): {
    rawToken: string;
    hashedToken: string;
};
/** Generate a slug from a name for environments. */
export declare function generateEnvSlug(name: string): string;
/** Compute changed fields between two objects for audit trail. */
export declare function computeChangedFields(oldValues: Record<string, unknown>, newValues: Record<string, unknown>): string[];
export declare function createOrganizationLogger(context: string): {
    info: (message: string, meta?: unknown) => void;
    error: (message: string, error?: unknown) => void;
    warn: (message: string, meta?: unknown) => void;
};
//# sourceMappingURL=index.d.ts.map