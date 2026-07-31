/**
 * Pure JSON traversal utilities shared by the compiler and the editable-view
 * projection/mutation layers. No side effects beyond the working object passed
 * to `setAtPath`.
 */
import { toJsonPointer } from "./editable-allowlist.js";
/** A JSON value is a leaf if it is scalar, null, an array, or an empty object. */
function isLeaf(value) {
    return value === null
        || typeof value !== "object"
        || Array.isArray(value)
        || Object.keys(value).length === 0;
}
/**
 * Enumerate every leaf path in nested JSON. Non-empty objects are descended
 * into; scalars, null, arrays, and empty objects are values. Treating an empty
 * nested object as a touched value prevents unknown/protected containers from
 * bypassing mutation validation.
 */
export function enumerateLeafPaths(value, base = []) {
    const results = [];
    if (isLeaf(value)) {
        results.push({ segments: base, pointer: toJsonPointer(base), value });
        return results;
    }
    const record = value;
    for (const key of Object.keys(record)) {
        results.push(...enumerateLeafPaths(record[key], [...base, key]));
    }
    return results;
}
/** Read a nested value by reference-token segments; returns undefined if absent. */
export function getAtPath(root, segments) {
    let current = root;
    for (const segment of segments) {
        if (current === null || typeof current !== "object")
            return undefined;
        current = current[segment];
    }
    return current;
}
/**
 * Set a nested value by reference-token segments, creating intermediate objects
 * as needed. Mutates `root` (callers pass a working clone). No-op for empty
 * segment lists.
 */
export function setAtPath(root, segments, value) {
    if (segments.length === 0)
        return;
    let current = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
        const key = segments[i];
        const next = current[key];
        if (next === null || typeof next !== "object" || Array.isArray(next)) {
            current[key] = {};
        }
        current = current[key];
    }
    current[segments[segments.length - 1]] = value;
}
/** Structural clone of plain JSON data (objects, arrays, scalars). */
export function deepClone(value) {
    if (value === null || typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map((entry) => deepClone(entry));
    const out = {};
    for (const key of Object.keys(value)) {
        out[key] = deepClone(value[key]);
    }
    return out;
}
//# sourceMappingURL=traversal.js.map