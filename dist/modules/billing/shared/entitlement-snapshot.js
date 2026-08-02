export const EVENT_LIMIT_FEATURE_KEY = 'monthly_events';
export const AI_CREDIT_LIMIT_FEATURE_KEY = 'module_ai_insights_monthly_credits';
export const POSTGRES_BIGINT_MAX = '9223372036854775807';
export function entitlementValue(row) {
    if (row.boolean_value !== null)
        return row.boolean_value;
    if (row.integer_value !== null)
        return Number(row.integer_value);
    if (row.decimal_value !== null)
        return Number(row.decimal_value);
    return row.string_value;
}
export function integerEntitlement(rows, featureKey) {
    const row = rows.find((entitlement) => entitlement.feature_key === featureKey);
    if (!row || row.integer_value === null)
        return 0;
    return Number(row.integer_value);
}
export function usageLimitParameter(limit) {
    return limit < 0 ? POSTGRES_BIGINT_MAX : limit;
}
export function buildModulesSnapshot(rows) {
    const modules = {};
    for (const row of rows) {
        const moduleKey = row.module ?? 'core';
        const module = modules[moduleKey] ?? { enabled: false, features: {} };
        const value = entitlementValue(row);
        module.features[row.feature_key] = value;
        if (row.is_module_root) {
            module.enabled = value === true || (typeof value === 'number' && value > 0) || (typeof value === 'string' && value.length > 0);
        }
        modules[moduleKey] = module;
    }
    return modules;
}
export function buildEntitlementsSnapshot(rows) {
    return Object.fromEntries(rows.map((row) => [row.feature_key, entitlementValue(row)]));
}
//# sourceMappingURL=entitlement-snapshot.js.map