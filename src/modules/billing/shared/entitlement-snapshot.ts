export const EVENT_LIMIT_FEATURE_KEY = 'quota.monthly_events';
export const AI_CREDIT_LIMIT_FEATURE_KEY = 'quota.ai_credits';
export const POSTGRES_BIGINT_MAX = '9223372036854775807';

export interface BillingEntitlementSnapshotRow {
  feature_key: string;
  module: string | null;
  is_module_root: boolean;
  value_type: string;
  boolean_value: boolean | null;
  integer_value: number | string | null;
  decimal_value: number | string | null;
  string_value: string | null;
}

export function entitlementValue(row: BillingEntitlementSnapshotRow): boolean | number | string | null {
  if (row.boolean_value !== null) return row.boolean_value;
  if (row.integer_value !== null) return Number(row.integer_value);
  if (row.decimal_value !== null) return Number(row.decimal_value);
  return row.string_value;
}

export function integerEntitlement(rows: BillingEntitlementSnapshotRow[], featureKey: string): number {
  const row = rows.find((entitlement) => entitlement.feature_key === featureKey);
  if (!row || row.integer_value === null) return 0;
  return Number(row.integer_value);
}

export function usageLimitParameter(limit: number): number | string {
  return limit < 0 ? POSTGRES_BIGINT_MAX : limit;
}

export function buildModulesSnapshot(rows: BillingEntitlementSnapshotRow[]): Record<string, unknown> {
  const modules: Record<string, { enabled: boolean; features: Record<string, unknown> }> = {};
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

export function buildEntitlementsSnapshot(rows: BillingEntitlementSnapshotRow[]): Record<string, unknown> {
  return Object.fromEntries(rows.map((row) => [row.feature_key, entitlementValue(row)]));
}
