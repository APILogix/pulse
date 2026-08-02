export type PathClass = "editable" | "protected" | "unknown";
export interface PathClassification {
    pathClass: PathClass;
    reason: "allowlisted" | "protected" | "container" | "root" | "unknown";
}
/** Arrays are validated and replaced as one editable value. */
export declare const EDITABLE_ARRAY_POINTERS: Set<string>;
/** No instrumentation options exist in the new wire contract. */
export declare const INSTRUMENTATION_OPTION_ALLOWLIST_V1: Readonly<{}>;
export declare function toJsonPointer(segments: string[]): string;
export declare function classifyLeafPath(segments: string[]): PathClassification;
//# sourceMappingURL=editable-allowlist.d.ts.map