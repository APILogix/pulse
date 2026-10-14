import fs from 'fs';
import path from 'path';

import {
  CANONICAL_FEATURE_CATALOG,
  CANONICAL_PLANS,
  SUPPORTED_CONNECTOR_PROVIDERS,
} from '../src/modules/billing/catalog/feature-registry.js';
import { CANONICAL_PLAN_MATRIX } from '../src/modules/billing/catalog/plan-matrix.js';
import { catalogValidator } from '../src/modules/billing/catalog/catalog-validator.js';

const root = process.cwd();

// 1. Run Catalog Validator & Output validation report
const validationReport = catalogValidator.generateReportFile(
  path.join(root, 'docs/billing/billing-validation-report.json'),
);
console.log(
  `Generated docs/billing/billing-validation-report.json (Valid: ${validationReport.isValid}, Errors: ${validationReport.summary.errorsCount}, Warnings: ${validationReport.summary.warningsCount})`,
);

// 2. Build canonical billing-plans.json
const canonicalPlansJson = {
  schema_version: '2.2.0',
  catalog_version: 2,
  generated_at: new Date().toISOString(),
  authority_status: 'informational_canonical_consolidated',
  companion_catalog_files: {
    master_plans_catalog: 'docs/billing/billing-plans.json',
    features_catalog: 'docs/billing/billing-features-catalog.json',
    entitlement_matrix: 'docs/billing/billing-entitlement-matrix.json',
    credits_and_metering: 'docs/billing/billing-credits-and-metering.json',
    validation_report: 'docs/billing/billing-validation-report.json',
    catalog_audit_report_markdown: 'docs/billing/billing-plan-audit.md',
  },
  runtime_source_of_truth: {
    primary_database_tables: [
      'plans',
      'plan_prices',
      'billing_features',
      'plan_feature_entitlements',
      'organization_subscriptions',
      'organization_usage_current_period',
      'usage_counter_staging',
      'usage_daily_counters',
      'billing_event_credit_weights',
      'credit_balances',
      'credit_ledger',
      'credit_rules',
      'ai_model_routes',
    ],
    typescript_catalog_files: [
      'src/modules/billing/catalog/feature-registry.ts',
      'src/modules/billing/catalog/plan-matrix.ts',
      'src/modules/billing/catalog/catalog-validator.ts',
    ],
    sql_seeder_files: [
      'database/primarydbv2/schema/20_seeders/004_11_billing_catalog_plans_and_prices.sql',
      'database/primarydbv2/schema/20_seeders/005_11_billing_catalog_features.sql',
      'database/primarydbv2/schema/20_seeders/006_11_billing_catalog_plan_entitlements.sql',
      'database/primarydbv2/schema/20_seeders/007_11_billing_event_credit_weights.sql',
    ],
  },
  default_currency: 'USD',
  supported_billing_intervals: ['monthly', 'annual'],
  annual_discount_policy: '2_months_free_10x_monthly',
  plans_count: CANONICAL_PLANS.length,
  features_count: CANONICAL_FEATURE_CATALOG.length,
  plans: CANONICAL_PLANS.map((planKey) => {
    const entry = CANONICAL_PLAN_MATRIX[planKey];
    const plan = entry.plan;
    const quotas: Record<string, unknown> = {};
    const features: Record<string, unknown> = {};
    const integrations: Record<string, unknown> = {};

    for (const feat of entry.features) {
      const def = CANONICAL_FEATURE_CATALOG.find((f) => f.key === feat.featureKey);
      if (!def) continue;

      const featItem: Record<string, unknown> = {
        key: feat.featureKey,
        name: def.name,
        value: feat.value,
        unit: def.unit,
        scope: def.scope,
        enforcement_type: def.enforcementType,
      };
      if (feat.overageRate !== undefined) {
        featItem.overage_rate_cents = feat.overageRate;
        featItem.overage_unit = feat.overageUnit;
        featItem.grace_percent = feat.gracePercent;
      }

      if (def.category === 'quota') {
        quotas[feat.featureKey] = featItem;
      } else if (def.category === 'integration') {
        integrations[feat.featureKey] = featItem;
      } else {
        features[feat.featureKey] = featItem;
      }
    }

    return {
      id: plan.id,
      key: plan.key,
      name: plan.name,
      tier: plan.tier,
      description: plan.description,
      trial_days: plan.trialDays,
      sort_order: plan.sortOrder,
      is_public: plan.isPublic,
      is_customizable: plan.isCustomizable,
      next_plan_key: plan.nextPlanKey,
      badge: plan.badge,
      metadata: plan.metadata,
      prices: plan.prices,
      monthly_event_credit_pool: (quotas['quota.monthly_events'] as any)?.value ?? 0,
      quotas,
      features,
      integrations,
    };
  }),
};

fs.writeFileSync(
  path.join(root, 'docs/billing/billing-plans.json'),
  JSON.stringify(canonicalPlansJson, null, 2),
  'utf8',
);
console.log(`Generated docs/billing/billing-plans.json`);

// 3. Update docs/billing/billing-credits-and-metering.json
const creditsAndMeteringPath = path.join(root, 'docs/billing/billing-credits-and-metering.json');
const creditsAndMetering = JSON.parse(fs.readFileSync(creditsAndMeteringPath, 'utf8'));

creditsAndMetering.telemetry_event_credit_system.monthly_credit_allowance_by_plan = {
  free: 50000,
  starter: 250000,
  growth: 1500000,
  business: 10000000,
  enterprise: 50000000,
};

creditsAndMetering.telemetry_event_credit_system.credit_weights_schedule = {
  request: { credit_weight: 1.0, description: 'Full HTTP / RPC request', is_active: true },
  error: { credit_weight: 1.5, description: 'Error / Exception with stack trace', is_active: true },
  trace: { credit_weight: 0.5, description: 'Distributed trace root', is_active: true },
  span: { credit_weight: 0.25, description: 'Individual trace span', is_active: true },
  log: { credit_weight: 0.12, description: 'Structured log line', is_active: true },
  metric: { credit_weight: 0.1, description: 'Custom metric data point', is_active: true },
  profile: { credit_weight: 2.0, description: 'Continuous CPU / memory profile sample', is_active: true },
  replay: { credit_weight: 2.0, description: 'Session replay recording segment', is_active: true },
  message: { credit_weight: 0.3, description: 'Custom message / breadcrumb', is_active: true },
  cron_checkin: { credit_weight: 0.2, description: 'Cron monitor check-in heartbeat', is_active: true },
};

fs.writeFileSync(creditsAndMeteringPath, JSON.stringify(creditsAndMetering, null, 2), 'utf8');
console.log(
  `Updated docs/billing/billing-credits-and-metering.json with profile weight 2.0 and shared event pools.`,
);

// 4. Update docs/billing/billing-features-catalog.json
const featuresCatalogPath = path.join(root, 'docs/billing/billing-features-catalog.json');
const featuresCatalogJson = {
  schema_version: '2.2.0',
  catalog_version: 2,
  generated_at: new Date().toISOString(),
  features_count: CANONICAL_FEATURE_CATALOG.length,
  supported_connectors_count: SUPPORTED_CONNECTOR_PROVIDERS.length,
  supported_connectors: [...SUPPORTED_CONNECTOR_PROVIDERS],
  features: CANONICAL_FEATURE_CATALOG,
};
fs.writeFileSync(featuresCatalogPath, JSON.stringify(featuresCatalogJson, null, 2), 'utf8');
console.log(
  `Updated docs/billing/billing-features-catalog.json with ${CANONICAL_FEATURE_CATALOG.length} canonical features.`,
);
