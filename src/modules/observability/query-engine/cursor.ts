/**
 * Stable keyset cursor. The cursor encodes the boundary row's `(time, id)`
 * tuple and the sort direction it was produced under, so forward/backward
 * paging is deterministic and index-backed on billions of rows. Cursors are
 * opaque base64url — clients must treat them as tokens.
 */
import type { SortDirection } from './types.js';
import { QueryValidationError } from './errors.js';

export interface CursorPayload {
  /** ISO timestamp of the boundary row's time column. */
  t: string;
  /** Boundary row id (second key of the pagination tuple). */
  id: string;
  /** Sort direction the cursor was built under. */
  d: SortDirection;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode + validate a cursor. Returns a typed payload or throws a
 * {@link QueryValidationError} on any tampering/corruption (fail-closed).
 */
export function decodeCursor(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new QueryValidationError('Malformed pagination cursor');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new QueryValidationError('Malformed pagination cursor');
  }
  const obj = parsed as Record<string, unknown>;
  const t = obj.t;
  const id = obj.id;
  const d = obj.d;

  if (typeof t !== 'string' || Number.isNaN(new Date(t).getTime())) {
    throw new QueryValidationError('Malformed pagination cursor (time)');
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new QueryValidationError('Malformed pagination cursor (id)');
  }
  if (d !== 'asc' && d !== 'desc') {
    throw new QueryValidationError('Malformed pagination cursor (direction)');
  }
  return { t, id, d };
}
