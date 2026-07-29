/**
 * Error types for the remote SDK config domain.
 *
 * These carry a stable machine code, an HTTP status, and an optional list of
 * JSON-Pointer-scoped detail records so the management API can return precise,
 * pointer-level errors (design.md §7.1) without leaking protected internals.
 *
 * The codes intentionally distinguish `protected_field` (a real schema-v1 path
 * that is backend-owned) from `unknown_field` (a path that does not exist in
 * the schema at all). Both are rejected — never silently ignored.
 */
/**
 * A validation/authorization error raised while classifying, validating, or
 * compiling configuration. It never mutates state; the caller rejects the whole
 * request when this is thrown.
 */
export class SdkConfigError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, statusCode, details = []) {
        super(message);
        this.name = "SdkConfigError";
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
    /** All touched protected/unknown paths are rejected with 422 (design.md test gates). */
    static rejectedPaths(details) {
        const hasProtected = details.some((d) => d.rule === "protected");
        const hasUnknown = details.some((d) => d.rule === "unknown");
        const code = hasProtected && !hasUnknown ? "protected_field" : "unknown_field";
        const message = hasProtected && hasUnknown
            ? "Request contains protected and unknown fields"
            : hasProtected
                ? "Request attempts to modify one or more protected fields"
                : "Request contains one or more unknown fields";
        return new SdkConfigError(code, message, 422, details);
    }
}
/** Aggregates detail records and throws a single 422 when any exist. */
export class SdkConfigErrorCollector {
    details = [];
    add(detail) {
        this.details.push(detail);
    }
    addAll(details) {
        for (const detail of details)
            this.details.push(detail);
    }
    get length() {
        return this.details.length;
    }
    list() {
        return [...this.details];
    }
    /** Throws a single aggregated 422 error when any detail has been collected. */
    throwIfAny(code = "schema_invalid", message = "Configuration is invalid") {
        if (this.details.length === 0)
            return;
        const onlyProtectedOrUnknown = this.details.every((d) => d.rule === "protected" || d.rule === "unknown");
        if (onlyProtectedOrUnknown) {
            throw SdkConfigError.rejectedPaths(this.details);
        }
        throw new SdkConfigError(code, message, 422, this.details);
    }
}
//# sourceMappingURL=errors.js.map