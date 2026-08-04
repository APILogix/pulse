/**
 * Deterministic canonical JSON serialization and SHA-256 hashing.
 *
 * Requirements (design.md §5 / Property 5 "Deterministic Hashes"):
 * - Byte-identical output regardless of input key order.
 * - Object keys sorted by UTF-16 code unit (matches RFC 8785 / JS default sort).
 * - Numbers normalized to their shortest round-trip form; NaN/Infinity rejected.
 * - `meta.configHash` is omitted from the hash input to avoid self-reference.
 *
 * This is used for the immutable revision `canonical_sha256`, the delivery
 * ETag, and stable request/idempotency hashing of editable intent.
 */
import { createHash } from "node:crypto";
import { SdkConfigError } from "./errors.js";
/** Canonicalize a finite number to its shortest round-trip decimal string. */
function canonicalizeNumber(value) {
    if (!Number.isFinite(value)) {
        throw new SdkConfigError("type_error", "Non-finite numbers are not permitted in configuration", 422, [
            { path: "", rule: "type", message: "Number must be finite (no NaN or Infinity)" },
        ]);
    }
    // Normalize negative zero to "0" so -0 and 0 hash identically.
    if (Object.is(value, -0))
        return "0";
    // JSON.stringify emits the ECMAScript shortest round-trip representation for
    // numbers, which is the RFC 8785 number production for the values we store.
    return JSON.stringify(value);
}
/**
 * Serialize a JSON value deterministically. Object keys are sorted; `undefined`
 * properties are omitted (matching JSON semantics); functions/symbols/bigint are
 * rejected because they can never appear in a valid schema-v1 document.
 */
export function canonicalJson(value) {
    if (value === null)
        return "null";
    const type = typeof value;
    if (type === "number")
        return canonicalizeNumber(value);
    if (type === "boolean")
        return value ? "true" : "false";
    if (type === "string")
        return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
    }
    if (type === "object") {
        const record = value;
        const keys = Object.keys(record).sort();
        const parts = [];
        for (const key of keys) {
            const entry = record[key];
            if (entry === undefined)
                continue;
            parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
        }
        return `{${parts.join(",")}}`;
    }
    throw new SdkConfigError("type_error", `Unsupported value type in configuration: ${type}`, 422, [
        { path: "", rule: "type", message: `Value of type ${type} cannot be serialized` },
    ]);
}
/** SHA-256 hex digest of an already-canonical string. */
export function sha256Hex(input) {
    return createHash("sha256").update(input, "utf8").digest("hex");
}
/** Canonical SHA-256 of any JSON value (e.g. editable intent, request bodies). */
export function hashValue(value) {
    return sha256Hex(canonicalJson(value));
}
/**
 * Compute the canonical hash of a compiled/delivery schema-v1 document, omitting
 * `meta.configHash` from the hash input so the digest never depends on itself.
 * The rest of `meta` (generatedAt, generatedBy) is retained per Property 5.
 */
export function computeConfigHash(config) {
    const { meta, ...rest } = config;
    const metaForHash = {
        generatedAt: meta.generatedAt,
        generatedBy: meta.generatedBy,
    };
    return sha256Hex(canonicalJson({ ...rest, meta: metaForHash }));
}
//# sourceMappingURL=canonical.js.map