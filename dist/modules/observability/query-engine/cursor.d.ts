import type { ExplorerQuery, QueryContext, SortDirection } from './types.js';
import type { ExplorerResource } from './field-registry.js';
export interface CursorPayload {
    /** Cursor format version. */
    v: 1;
    /** ISO timestamp of the boundary row's time column. */
    t: string;
    /** Boundary row id (second key of the pagination tuple). */
    id: string;
    /** Sort field used to create the cursor. */
    f: string;
    /** Sort direction used to create the cursor. */
    d: SortDirection;
    /** Registered resource name. */
    r: string;
    /** HMAC-bound query and tenant scope fingerprint. */
    s: string;
    /** Unix epoch expiry in milliseconds. */
    e: number;
}
export interface CursorExpectation {
    resource: string;
    sortField: string;
    sortDirection: SortDirection;
    scope: string;
}
export declare function cursorScopeFingerprint(resource: ExplorerResource, ctx: QueryContext, query: ExplorerQuery): string;
export declare function createCursorPayload(resource: ExplorerResource, ctx: QueryContext, query: ExplorerQuery, boundary: {
    time: Date;
    id: string;
}): CursorPayload;
export declare function encodeCursor(payload: CursorPayload): string;
export declare function decodeCursor(cursor: string, expected?: CursorExpectation): CursorPayload;
//# sourceMappingURL=cursor.d.ts.map