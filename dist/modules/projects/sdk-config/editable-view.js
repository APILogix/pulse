/**
 * EditableConfigView projection and PUT/PATCH mutation traversal.
 *
 * The browser/management API exposes ONLY `EditableConfigView` (design.md §7.2,
 * ADR-009, Property 16). This module builds that DTO field-by-field from the
 * closed editable allowlist so it can never leak `compiled_snapshot`, protected
 * identity/topology, `meta`, `entitlements`, route URLs, or credentials.
 *
 * The mutation traversal enumerates every touched JSON pointer BEFORE mutating
 * and rejects protected/unknown paths (and unknown PUT envelope keys) with 422 —
 * even when nested under otherwise-editable objects. Nothing is silently dropped.
 */
import { canonicalJson } from "./canonical.js";
import { SdkConfigError, SdkConfigErrorCollector } from "./errors.js";
import { classifyLeafPath, toJsonPointer } from "./editable-allowlist.js";
import { deepClone, enumerateLeafPaths, getAtPath, setAtPath } from "./traversal.js";
import { validateEditableLeaf } from "./validator.js";
/**
 * Extract the editable subset of a compiled snapshot: every leaf that classifies
 * as `editable`, rebuilt field-by-field into a fresh object. Protected leaves
 * (sdk.*, meta.*, entitlements.*, transport.routes.*.url, schemaVersion) are
 * excluded by construction.
 */
export function extractEditableConfig(compiled) {
    const editable = {};
    for (const leaf of enumerateLeafPaths(compiled)) {
        if (leaf.segments.length === 0)
            continue;
        if (classifyLeafPath(leaf.segments).pathClass !== "editable")
            continue;
        setAtPath(editable, leaf.segments, deepClone(leaf.value));
    }
    return editable;
}
function jsonEqual(a, b) {
    return canonicalJson(a) === canonicalJson(b);
}
/**
 * Build the per-pointer effective summary by comparing requested intent to the
 * compiled effective value. When intent set a value and it survived unchanged,
 * the source is `project-environment`; when it was narrowed, `organization-policy`
 * with `constrained: true`; when intent did not set it, `schema-default`.
 */
function buildEffectiveSummary(editableConfig, requestedIntent) {
    const summary = {};
    for (const leaf of enumerateLeafPaths(editableConfig)) {
        if (leaf.segments.length === 0)
            continue;
        const pointer = toJsonPointer(leaf.segments);
        const intentValue = getAtPath(requestedIntent, leaf.segments);
        if (intentValue === undefined) {
            summary[pointer] = { value: leaf.value, source: "schema-default", constrained: false };
        }
        else if (jsonEqual(intentValue, leaf.value)) {
            summary[pointer] = { value: leaf.value, source: "project-environment", constrained: false };
        }
        else {
            summary[pointer] = { value: leaf.value, source: "organization-policy", constrained: true };
        }
    }
    return summary;
}
/** Project a safe EditableConfigView. Never includes protected/compiled fields. */
export function projectEditableView(input) {
    const editableConfig = extractEditableConfig(input.compiled);
    return {
        type: "editableConfigView",
        scope: input.scope,
        revision: {
            currentRevisionNo: input.currentRevisionNo,
            draftVersion: input.draftVersion ?? 0,
            workflowState: input.workflowState ?? "current",
        },
        editableConfig,
        effectiveSummary: buildEffectiveSummary(editableConfig, input.requestedIntent),
        validation: input.validation ?? { status: "not_validated", errors: [], warnings: [] },
    };
}
/** RFC 7386 JSON Merge Patch, rooted at editable intent. */
function applyMergePatch(target, patch) {
    for (const key of Object.keys(patch)) {
        const value = patch[key];
        if (value === null) {
            delete target[key];
        }
        else if (typeof value === "object" && !Array.isArray(value)) {
            const existing = target[key];
            const base = existing !== null && typeof existing === "object" && !Array.isArray(existing)
                ? existing
                : {};
            target[key] = applyMergePatch(base, value);
        }
        else {
            target[key] = value;
        }
    }
    return target;
}
/** Keep only editable, non-null leaves; drop empty containers and removals. */
function normalizeIntent(candidate) {
    const normalized = {};
    for (const leaf of enumerateLeafPaths(candidate)) {
        if (leaf.segments.length === 0)
            continue;
        if (leaf.value === null)
            continue;
        if (classifyLeafPath(leaf.segments).pathClass !== "editable")
            continue;
        setAtPath(normalized, leaf.segments, deepClone(leaf.value));
    }
    return normalized;
}
/**
 * Validate and apply a PUT/PATCH mutation to editable intent. Returns the new
 * normalized intent. Throws a 422 SdkConfigError listing every protected,
 * unknown, or invalid pointer WITHOUT mutating state when any exist.
 */
export function applyEditableMutation(input) {
    const { body, method } = input;
    let payload;
    if (method === "PUT") {
        // PUT body must be exactly `{ editableConfig: {...} }` — unknown envelope keys rejected.
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
            throw new SdkConfigError("envelope_invalid", "PUT body must be an object with an 'editableConfig' key", 422, [
                { path: "", rule: "envelope", message: "Expected { editableConfig: {...} }" },
            ]);
        }
        const record = body;
        const extraKeys = Object.keys(record).filter((key) => key !== "editableConfig");
        if (extraKeys.length > 0) {
            throw new SdkConfigError("envelope_invalid", "PUT body contains unknown envelope keys", 422, extraKeys.map((key) => ({ path: `/${key}`, rule: "unknown", message: `Unknown envelope key '${key}'` })));
        }
        const editableConfig = record["editableConfig"];
        if (editableConfig === null || typeof editableConfig !== "object" || Array.isArray(editableConfig)) {
            throw new SdkConfigError("envelope_invalid", "'editableConfig' must be an object", 422, [
                { path: "/editableConfig", rule: "type", message: "editableConfig must be an object" },
            ]);
        }
        payload = editableConfig;
    }
    else {
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
            throw new SdkConfigError("envelope_invalid", "PATCH body must be a JSON Merge Patch object", 422, [
                { path: "", rule: "envelope", message: "Expected a merge-patch object rooted at editable intent" },
            ]);
        }
        payload = body;
    }
    // Traverse EVERY touched pointer before mutating. Reject protected/unknown and
    // validate editable value bounds. Collect all details for a single 422.
    const collector = new SdkConfigErrorCollector();
    for (const leaf of enumerateLeafPaths(payload)) {
        if (leaf.segments.length === 0)
            continue;
        const classification = classifyLeafPath(leaf.segments);
        const pointer = toJsonPointer(leaf.segments);
        if (classification.pathClass === "protected") {
            collector.add({ path: pointer, rule: "protected", message: "Field is protected and cannot be modified" });
            continue;
        }
        if (classification.pathClass === "unknown") {
            collector.add({ path: pointer, rule: "unknown", message: "Unknown field" });
            continue;
        }
        // Editable. `null` is a removal (PATCH) and skips bounds validation.
        if (leaf.value === null)
            continue;
        collector.addAll(validateEditableLeaf(leaf.segments, leaf.value));
    }
    collector.throwIfAny("schema_invalid", "Editable configuration is invalid");
    // Safe to build the new intent — no state was changed above.
    const candidate = method === "PUT"
        ? deepClone(payload)
        : applyMergePatch(deepClone(input.currentIntent), payload);
    return normalizeIntent(candidate);
}
//# sourceMappingURL=editable-view.js.map