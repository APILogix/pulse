import { QueryValidationError } from './errors.js';
export function encodeCursor(payload) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
/**
 * Decode + validate a cursor. Returns a typed payload or throws a
 * {@link QueryValidationError} on any tampering/corruption (fail-closed).
 */
export function decodeCursor(cursor) {
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    }
    catch {
        throw new QueryValidationError('Malformed pagination cursor');
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new QueryValidationError('Malformed pagination cursor');
    }
    const obj = parsed;
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
//# sourceMappingURL=cursor.js.map