/**
 * Shared Public ID Generator & Utility.
 *
 * Provides deterministic formatting, validation, and prefix mapping for
 * human-readable Public IDs across all user-facing observability entities.
 * Format: PREFIX-000000000 (e.g. REQ-000000001, ERR-000000001).
 */
export declare const PUBLIC_ID_PREFIXES: {
    readonly requests: "REQ";
    readonly errors: "ERR";
    readonly errorGroups: "ISS";
    readonly traces: "TRC";
    readonly spans: "SPN";
    readonly logs: "LOG";
    readonly messages: "MSG";
    readonly sessions: "SES";
    readonly replays: "RPL";
    readonly profiles: "PRF";
    readonly cronCheckins: "CRN";
    readonly metrics: "MTR";
};
export type PublicIdEntity = keyof typeof PUBLIC_ID_PREFIXES;
export type PublicIdPrefix = (typeof PUBLIC_ID_PREFIXES)[PublicIdEntity];
/** Format a sequence or integer ID into a canonical Public ID string. */
export declare function formatPublicId(prefix: PublicIdPrefix, num: number | bigint | string): string;
/**
 * Generate a deterministic or monotonic public ID.
 * When num is supplied, it formats it identically to formatPublicId.
 * Otherwise, generates a safe 9-digit padded sequence number.
 */
export declare function generatePublicId(prefix: PublicIdPrefix, num?: number | bigint | string): string;
/** Returns true if the string is a valid Public ID format (e.g. REQ-000000001). */
export declare function isPublicId(value: unknown): value is string;
/** Extract the entity prefix from a Public ID string. */
export declare function extractPublicIdPrefix(publicId: string): PublicIdPrefix | null;
//# sourceMappingURL=public-id-generator.d.ts.map