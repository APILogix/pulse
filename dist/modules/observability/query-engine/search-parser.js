import { QueryValidationError } from './errors.js';
/** Tokenize respecting double quotes; keeps `key:"a b"` and `"a b"` intact. */
function tokenize(input) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
            current += ch;
            continue;
        }
        if (ch === ' ' && !inQuotes) {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += ch;
    }
    if (current.length > 0)
        tokens.push(current);
    return tokens;
}
/** Strip a single layer of wrapping double quotes. */
function unquote(value) {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1);
    }
    return value;
}
/** Detect the operator embedded in a token and split key/op/value. */
function splitToken(token) {
    // Order matters: check two-char operators before single-char.
    const patterns = [
        { sep: '>=', op: 'gte' },
        { sep: '<=', op: 'lte' },
        { sep: '!=', op: 'neq' },
        { sep: ':', op: 'eq' },
        { sep: '>', op: 'gt' },
        { sep: '<', op: 'lt' },
    ];
    let best = null;
    for (const { sep, op } of patterns) {
        const idx = token.indexOf(sep);
        if (idx > 0) {
            // Prefer the earliest separator so `latency>=100` beats a later `:`.
            if (!best || idx < best.idx) {
                best = { key: token.slice(0, idx), op, value: token.slice(idx + sep.length), idx };
            }
        }
    }
    if (!best)
        return null;
    return { key: best.key, op: best.op, value: best.value };
}
/** Resolve a search key to a registered field name (respecting aliases). */
function resolveKey(resource, key) {
    if (resource.fields[key])
        return key;
    const aliased = resource.searchAliases?.[key];
    if (aliased && resource.fields[aliased])
        return aliased;
    return null;
}
export function parseSearch(resource, search) {
    const filters = [];
    const text = [];
    if (!search || search.trim().length === 0)
        return { filters, text };
    for (const token of tokenize(search.trim())) {
        const split = splitToken(token);
        if (!split) {
            text.push(unquote(token));
            continue;
        }
        const fieldName = resolveKey(resource, split.key);
        if (!fieldName) {
            throw new QueryValidationError(`Unknown search key '${split.key}' for resource '${resource.name}'`, {
                key: split.key,
            });
        }
        const rawValue = unquote(split.value);
        if (rawValue.length === 0) {
            throw new QueryValidationError(`Search key '${split.key}' is missing a value`);
        }
        // `key:a,b,c` becomes an `in` filter; comparison ops stay scalar.
        if (split.op === 'eq' && rawValue.includes(',')) {
            const parts = rawValue.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
            filters.push({ field: fieldName, op: 'in', value: parts });
        }
        else {
            filters.push({ field: fieldName, op: split.op, value: rawValue });
        }
    }
    return { filters, text };
}
//# sourceMappingURL=search-parser.js.map