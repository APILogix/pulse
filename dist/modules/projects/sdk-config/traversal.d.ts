export interface LeafPath {
    segments: string[];
    pointer: string;
    value: unknown;
}
/**
 * Enumerate every leaf path in nested JSON. Non-empty objects are descended
 * into; scalars, null, arrays, and empty objects are values. Treating an empty
 * nested object as a touched value prevents unknown/protected containers from
 * bypassing mutation validation.
 */
export declare function enumerateLeafPaths(value: unknown, base?: string[]): LeafPath[];
/** Read a nested value by reference-token segments; returns undefined if absent. */
export declare function getAtPath(root: unknown, segments: string[]): unknown;
/**
 * Set a nested value by reference-token segments, creating intermediate objects
 * as needed. Mutates `root` (callers pass a working clone). No-op for empty
 * segment lists.
 */
export declare function setAtPath(root: Record<string, unknown>, segments: string[], value: unknown): void;
/** Structural clone of plain JSON data (objects, arrays, scalars). */
export declare function deepClone<T>(value: T): T;
//# sourceMappingURL=traversal.d.ts.map