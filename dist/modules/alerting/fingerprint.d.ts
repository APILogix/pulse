/**
 * Produce a deterministic, order-independent representation of an object's
 * leaf values keyed by dotted path. Arrays are indexed. Used so payloads that
 * differ only in key ordering hash identically.
 */
export declare function normalizePayload(payload: unknown, prefix?: string): Record<string, string>;
export interface FingerprintInput {
    ruleId: string | null;
    source: string;
    payload: Record<string, unknown>;
    /** Optional subset of payload keys to base the fingerprint on. */
    keyFields?: string[];
}
/** Compute the deduplication fingerprint for an event. */
export declare function computeFingerprint(input: FingerprintInput): string;
/**
 * Render a deduplication key template such as
 * `{{rule_id}}:{{source}}:{{fingerprint}}` using the provided context.
 * Unknown placeholders render as empty strings.
 */
export declare function renderDedupKey(template: string, ctx: {
    ruleId: string | null;
    source: string;
    fingerprint: string;
}): string;
//# sourceMappingURL=fingerprint.d.ts.map