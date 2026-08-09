export declare const ERROR_FINGERPRINT_VERSION = 2;
export declare const SEVERITY_RANK: Record<string, number>;
export type StackFrame = {
    filename?: unknown;
    file?: unknown;
    module?: unknown;
    function?: unknown;
    functionName?: unknown;
    lineno?: unknown;
    lineNumber?: unknown;
    inApp?: unknown;
    in_app?: unknown;
};
export declare function normalizeStackFrames(frames: unknown): string[];
export declare function computeErrorFingerprint(errorType: string, frames: unknown): string;
export declare function severityRank(severity: unknown): number;
export declare function normalizeSeverity(severity: unknown): string;
export declare function compareReleases(left: string | null | undefined, right: string | null | undefined): number | null;
export declare function isReleaseEligible(incomingRelease: string | null | undefined, resolvedRelease: string | null | undefined): boolean;
//# sourceMappingURL=fingerprint.d.ts.map