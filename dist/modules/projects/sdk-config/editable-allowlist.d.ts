/**
 * Closed editable path allowlist and protected/unknown classification.
 *
 * This is the security core of remote config management (design.md §8.1/§8.2,
 * ADR-009). Every touched JSON pointer in a PUT/PATCH body is classified as
 * exactly one of:
 *   - "editable"  : an allowlisted user-writable leaf, subject to bounds/policy.
 *   - "protected" : a real schema-v1 location that is backend-owned (rejected).
 *   - "unknown"   : a path that is not part of schema-v1 at all (rejected).
 *
 * Protected and unknown are BOTH rejected with 422 — never silently ignored.
 * The allowlist is closed: it cannot be extended at runtime. `transport.routes.
 * *.url`, `schemaVersion`, `sdk.*`, `meta.*`, and `entitlements.*` are protected.
 */
import { type IntegrationKey } from "./schema-v1.js";
export type PathClass = "editable" | "protected" | "unknown";
export interface PathClassification {
    pathClass: PathClass;
    /** Short reason token: `allowlisted`, `protected`, `container`, `unknown`. */
    reason: string;
}
/**
 * Versioned, closed registry of safe declarative instrumentation option leaves.
 * Only scalar options may ever appear here — never callbacks, code, module/file
 * paths, URLs, headers, or credentials (design.md §8.1). Leaves absent from this
 * registry are classified `unknown`.
 */
export declare const INSTRUMENTATION_OPTION_ALLOWLIST_V1: Readonly<Record<IntegrationKey, Readonly<Record<string, "boolean" | "number" | "string">>>>;
/** Editable leaves that are arrays (the whole array is the writable unit). */
export declare const EDITABLE_ARRAY_POINTERS: Set<string>;
/** Join reference-token segments into an RFC 6901 JSON Pointer string. */
export declare function toJsonPointer(segments: string[]): string;
/**
 * Classify a leaf path (as reference-token segments) against the closed
 * schema-v1 allowlist. The function never throws; callers decide how to react.
 */
export declare function classifyLeafPath(segments: string[]): PathClassification;
//# sourceMappingURL=editable-allowlist.d.ts.map