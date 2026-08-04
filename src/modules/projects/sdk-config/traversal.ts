/**
 * Pure JSON traversal utilities shared by the compiler and the editable-view
 * projection/mutation layers. No side effects beyond the working object passed
 * to `setAtPath`.
 */
import { toJsonPointer } from "./editable-allowlist.js";

export interface LeafPath {
  segments: string[];
  pointer: string;
  value: unknown;
}

/** A JSON value is a leaf if it is scalar, null, an array, or an empty object. */
function isLeaf(value: unknown): boolean {
  return value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value as Record<string, unknown>).length === 0;
}

/**
 * Enumerate every leaf path in nested JSON. Non-empty objects are descended
 * into; scalars, null, arrays, and empty objects are values. Treating an empty
 * nested object as a touched value prevents unknown/protected containers from
 * bypassing mutation validation.
 */
export function enumerateLeafPaths(value: unknown, base: string[] = []): LeafPath[] {
  const results: LeafPath[] = [];
  if (isLeaf(value)) {
    results.push({ segments: base, pointer: toJsonPointer(base), value });
    return results;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    results.push(...enumerateLeafPaths(record[key], [...base, key]));
  }
  return results;
}

/** Read a nested value by reference-token segments; returns undefined if absent. */
export function getAtPath(root: unknown, segments: string[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Set a nested value by reference-token segments, creating intermediate objects
 * as needed. Mutates `root` (callers pass a working clone). No-op for empty
 * segment lists.
 */
export function setAtPath(root: Record<string, unknown>, segments: string[], value: unknown): void {
  if (segments.length === 0) return;
  let current: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]!;
    const next = current[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]!] = value;
}

/** Structural clone of plain JSON data (objects, arrays, scalars). */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => deepClone(entry)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return out as T;
}
