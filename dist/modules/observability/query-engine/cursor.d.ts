/**
 * Stable keyset cursor. The cursor encodes the boundary row's `(time, id)`
 * tuple and the sort direction it was produced under, so forward/backward
 * paging is deterministic and index-backed on billions of rows. Cursors are
 * opaque base64url — clients must treat them as tokens.
 */
import type { SortDirection } from './types.js';
export interface CursorPayload {
    /** ISO timestamp of the boundary row's time column. */
    t: string;
    /** Boundary row id (second key of the pagination tuple). */
    id: string;
    /** Sort direction the cursor was built under. */
    d: SortDirection;
}
export declare function encodeCursor(payload: CursorPayload): string;
/**
 * Decode + validate a cursor. Returns a typed payload or throws a
 * {@link QueryValidationError} on any tampering/corruption (fail-closed).
 */
export declare function decodeCursor(cursor: string): CursorPayload;
//# sourceMappingURL=cursor.d.ts.map