export interface LeafPath {
    segments: string[];
    pointer: string;
    value: unknown;
}
/**
 * Enumerate every leaf path in a nested object. Objects are descended into;
 * scalars, `null`, and arrays are treated as leaves (the whole array is the
 * value). Used to enumerate every touched pointer in a PUT/PATCH body and to
 * apply validated intent during compilation.
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