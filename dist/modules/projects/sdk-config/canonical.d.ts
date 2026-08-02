import type { SchemaV1Config } from "./schema-v1.js";
/**
 * Serialize a JSON value deterministically. Object keys are sorted; `undefined`
 * properties are omitted (matching JSON semantics); functions/symbols/bigint are
 * rejected because they can never appear in a valid schema-v1 document.
 */
export declare function canonicalJson(value: unknown): string;
/** SHA-256 hex digest of an already-canonical string. */
export declare function sha256Hex(input: string): string;
/** Canonical SHA-256 of any JSON value (e.g. editable intent, request bodies). */
export declare function hashValue(value: unknown): string;
/**
 * Compute the canonical hash of a compiled/delivery schema-v1 document, omitting
 * `meta.configHash` from the hash input so the digest never depends on itself.
 * The rest of `meta` (generatedAt, generatedBy) is retained per Property 5.
 */
export declare function computeConfigHash(config: SchemaV1Config): string;
//# sourceMappingURL=canonical.d.ts.map