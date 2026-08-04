import { QueryValidationError } from './errors.js';
/**
 * Collects bound parameters and hands out positional placeholders (`$1`, `$2`
 * …). One bag is used per built statement so numbering stays consistent.
 */
export class ParamBag {
    values = [];
    /** Bind a value and return its placeholder token. */
    next(value) {
        this.values.push(value);
        return `$${this.values.length}`;
    }
    get params() {
        return this.values;
    }
    get size() {
        return this.values.length;
    }
}
/** Operators that do not consume a value. */
const NULLARY_OPERATORS = new Set(['exists', 'nexists']);
/** Operators whose value must be an array. */
const ARRAY_OPERATORS = new Set(['in', 'nin', 'between']);
/** All operators, exported for facet metadata and validation. */
export const ALL_OPERATORS = [
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'in', 'nin', 'contains', 'ncontains',
    'startsWith', 'endsWith', 'exists', 'nexists', 'between',
];
/** Operators that only make sense for ordered (numeric/temporal) fields. */
export const COMPARISON_OPERATORS = ['gt', 'gte', 'lt', 'lte', 'between'];
/** Operators that only make sense for text fields. */
export const TEXT_OPERATORS = ['contains', 'ncontains', 'startsWith', 'endsWith'];
/**
 * Coerce and validate a raw value against a field type. Throws a
 * {@link QueryValidationError} (400) on any mismatch so bad input never reaches
 * the database as a runtime cast error.
 */
export function coerceScalar(value, type, field) {
    switch (type) {
        case 'number': {
            const n = typeof value === 'number' ? value : Number(value);
            if (!Number.isFinite(n))
                throw new QueryValidationError(`Filter '${field}' expects a number`);
            return n;
        }
        case 'boolean': {
            if (typeof value === 'boolean')
                return value;
            if (value === 'true')
                return true;
            if (value === 'false')
                return false;
            throw new QueryValidationError(`Filter '${field}' expects a boolean`);
        }
        case 'timestamp': {
            const d = value instanceof Date ? value : new Date(String(value));
            if (Number.isNaN(d.getTime()))
                throw new QueryValidationError(`Filter '${field}' expects a timestamp`);
            return d;
        }
        case 'uuid': {
            const s = String(value);
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
                throw new QueryValidationError(`Filter '${field}' expects a UUID`);
            }
            return s;
        }
        case 'string':
        case 'enum':
        case 'json':
        default:
            return String(value);
    }
}
/**
 * Build a boolean SQL predicate for an operator against a resolved column
 * expression. `columnExpr` is trusted (registry-derived); every value is bound.
 */
export function buildOperatorFragment(columnExpr, op, type, value, field, bag) {
    if (NULLARY_OPERATORS.has(op)) {
        return op === 'exists' ? `${columnExpr} IS NOT NULL` : `${columnExpr} IS NULL`;
    }
    if (ARRAY_OPERATORS.has(op)) {
        if (!Array.isArray(value)) {
            throw new QueryValidationError(`Filter '${field}' with '${op}' expects an array`);
        }
        if (op === 'between') {
            if (value.length !== 2)
                throw new QueryValidationError(`Filter '${field}' 'between' expects exactly two values`);
            const lo = coerceScalar(value[0], type, field);
            const hi = coerceScalar(value[1], type, field);
            return `${columnExpr} BETWEEN ${bag.next(lo)} AND ${bag.next(hi)}`;
        }
        if (value.length === 0) {
            // An empty IN set matches nothing; an empty NIN matches everything.
            return op === 'in' ? 'FALSE' : 'TRUE';
        }
        const coerced = value.map((v) => coerceScalar(v, type, field));
        const placeholder = bag.next(coerced);
        return op === 'in' ? `${columnExpr} = ANY(${placeholder})` : `(${columnExpr} <> ALL(${placeholder}) OR ${columnExpr} IS NULL)`;
    }
    // Scalar operators.
    const scalar = coerceScalar(value, type, field);
    switch (op) {
        case 'eq':
            return `${columnExpr} = ${bag.next(scalar)}`;
        case 'neq':
            return `(${columnExpr} <> ${bag.next(scalar)} OR ${columnExpr} IS NULL)`;
        case 'gt':
            return `${columnExpr} > ${bag.next(scalar)}`;
        case 'gte':
            return `${columnExpr} >= ${bag.next(scalar)}`;
        case 'lt':
            return `${columnExpr} < ${bag.next(scalar)}`;
        case 'lte':
            return `${columnExpr} <= ${bag.next(scalar)}`;
        case 'contains':
            return `${columnExpr} ILIKE ${bag.next(`%${escapeLike(String(scalar))}%`)}`;
        case 'ncontains':
            return `(${columnExpr} NOT ILIKE ${bag.next(`%${escapeLike(String(scalar))}%`)} OR ${columnExpr} IS NULL)`;
        case 'startsWith':
            return `${columnExpr} ILIKE ${bag.next(`${escapeLike(String(scalar))}%`)}`;
        case 'endsWith':
            return `${columnExpr} ILIKE ${bag.next(`%${escapeLike(String(scalar))}`)}`;
        default:
            throw new QueryValidationError(`Unsupported operator '${op}' for filter '${field}'`);
    }
}
/** Escape LIKE wildcards in user input so `%`/`_` are treated literally. */
function escapeLike(input) {
    return input.replace(/([%_\\])/g, '\\$1');
}
//# sourceMappingURL=operators.js.map