export interface SanitizationResult<T> {
    value: T;
    redactionCount: number;
    injectionDetected: boolean;
    truncated: boolean;
}
/** Redacts and bounds arbitrary telemetry without mutating caller-owned data. */
export declare function sanitizeUntrusted<T>(input: T, maxChars: number): SanitizationResult<T>;
export declare function stableStringify(value: unknown): string;
export declare function sha256(value: unknown): string;
export declare function isUnsafeOfficialQuery(query: string | undefined): boolean;
export declare function extractJsonObject(raw: string): unknown;
//# sourceMappingURL=security.d.ts.map