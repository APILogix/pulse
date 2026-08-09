/**
 /**
 * Error Group canonical item assembler.
 *
 * Transforms raw `error_groups` logdb rows into the exact structured contract
 * expected by the frontend Error Groups table and detail pages.
 */
export interface ErrorGroupCanonicalItem {
    id: string;
    publicId: string;
    status: string;
    occurrences: {
        count: number;
        firstSeenAt: string | null;
        lastSeenAt: string | null;
    };
    severity: {
        highest: string;
        latest: string;
    };
    regression: {
        count: number;
        lastRegressedAt: string | null;
    };
    release: {
        latest: string | null;
        resolvedIn: string | null;
    };
    latestEvent: {
        publicId: string | null;
        errorName: string;
        message: string;
        statusCode: number | null;
        trace: {
            publicId: string | null;
            traceId: string | null;
        };
    };
}
export declare function assembleErrorGroupItem(raw: Record<string, unknown>, tracePublicIdMap?: Map<string, string>, eventPublicIdMap?: Map<string, string>): ErrorGroupCanonicalItem;
//# sourceMappingURL=error-group-assembler.d.ts.map