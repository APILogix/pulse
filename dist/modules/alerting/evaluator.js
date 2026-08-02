/** Read a dotted path from an object. Returns undefined if any segment is missing. */
export function readPath(obj, path) {
    if (!path)
        return undefined;
    let cur = obj;
    for (const seg of path.split('.')) {
        if (cur === null || cur === undefined || typeof cur !== 'object')
            return undefined;
        cur = cur[seg];
    }
    return cur;
}
function toNumber(v) {
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)))
        return Number(v);
    return null;
}
/** Evaluate a single condition against an actual value. */
export function evaluateCondition(operator, actual, expected) {
    switch (operator) {
        case 'exists':
            return actual !== undefined && actual !== null;
        case 'eq':
            return actual === expected || String(actual) === String(expected);
        case 'neq':
            return !(actual === expected || String(actual) === String(expected));
        case 'gt':
        case 'lt':
        case 'gte':
        case 'lte': {
            const a = toNumber(actual);
            const e = toNumber(expected);
            if (a === null || e === null)
                return false;
            if (operator === 'gt')
                return a > e;
            if (operator === 'lt')
                return a < e;
            if (operator === 'gte')
                return a >= e;
            return a <= e;
        }
        case 'contains':
            if (Array.isArray(actual))
                return actual.map(String).includes(String(expected));
            return typeof actual === 'string' && actual.includes(String(expected));
        case 'in':
            return Array.isArray(expected) && expected.map(String).includes(String(actual));
        case 'regex':
            try {
                return typeof actual === 'string' && new RegExp(String(expected)).test(actual);
            }
            catch {
                return false;
            }
        default:
            return false;
    }
}
/**
 * Evaluate all conditions against a payload and combine using the grouping
 * semantics described above.
 */
export function evaluateRule(payload, conditions) {
    const conditionResults = conditions.map((c) => {
        const actual = readPath(payload, c.fieldPath);
        const passed = evaluateCondition(c.operator, actual, c.thresholdValue);
        return { fieldPath: c.fieldPath, operator: c.operator, actual, expected: c.thresholdValue, passed };
    });
    if (conditions.length === 0) {
        return { matched: false, conditionResults };
    }
    // Partition into groups. Ungrouped conditions form their own singleton AND terms.
    const groups = new Map();
    const ungrouped = [];
    conditions.forEach((c, i) => {
        const passed = conditionResults[i].passed;
        if (c.conditionGroupId) {
            const arr = groups.get(c.conditionGroupId) ?? [];
            arr.push(passed);
            groups.set(c.conditionGroupId, arr);
        }
        else {
            ungrouped.push(passed);
        }
    });
    // Each group: OR. Ungrouped: each must individually pass (AND).
    const groupTruths = [...groups.values()].map((arr) => arr.some(Boolean));
    const allTerms = [...groupTruths, ...ungrouped];
    const matched = allTerms.length > 0 && allTerms.every(Boolean);
    return { matched, conditionResults };
}
//# sourceMappingURL=evaluator.js.map