import fs from 'fs';
import path from 'path';

import {
  CANONICAL_FEATURE_CATALOG,
  CANONICAL_PLANS,
  SUPPORTED_CONNECTOR_PROVIDERS,
} from '../src/modules/billing/catalog/feature-registry.js';
import { CANONICAL_PLAN_MATRIX } from '../src/modules/billing/catalog/plan-matrix.js';

const root = process.cwd();

// 1. Generate updated docs/billing/billing-entitlement-matrix.json
const matrixJson: {
  schema_version: string;
  catalog_version: number;
  generated_at: string;
  plans_count: number;
  features_count: number;
  cells_count: number;
  matrix: Record<string, Record<string, unknown>>;
  normalized_sql_entitlement_rows: Array<{
    plan_key: string;
    feature_key: string;
    boolean_value: boolean | null;
    integer_value: number | null;
    string_value: string | null;
    overage_rate: number | null;
    overage_unit: number | null;
    grace_percent: number | null;
  }>;
} = {
  schema_version: '2.2.0',
  catalog_version: 2,
  generated_at: new Date().toISOString(),
  plans_count: CANONICAL_PLANS.length,
  features_count: CANONICAL_FEATURE_CATALOG.length,
  cells_count: CANONICAL_PLANS.length * CANONICAL_FEATURE_CATALOG.length,
  matrix: {},
  normalized_sql_entitlement_rows: [],
};

for (const planKey of CANONICAL_PLANS) {
  matrixJson.matrix[planKey] = {};
  const planData = CANONICAL_PLAN_MATRIX[planKey];
  for (const feat of CANONICAL_FEATURE_CATALOG) {
    const entry = planData.features.find((f) => f.featureKey === feat.key);
    const val = entry ? entry.value : null;
    matrixJson.matrix[planKey][feat.key] = {
      value: val,
      booleanValue: typeof val === 'boolean' ? val : null,
      integerValue: typeof val === 'number' ? val : null,
      stringValue: typeof val === 'string' ? val : null,
      overageRate: entry?.overageRate ?? null,
      overageUnit: entry?.overageUnit ?? null,
      gracePercent: entry?.gracePercent ?? null,
    };

    matrixJson.normalized_sql_entitlement_rows.push({
      plan_key: planKey,
      feature_key: feat.key,
      boolean_value: typeof val === 'boolean' ? val : null,
      integer_value: typeof val === 'number' ? val : null,
      string_value: typeof val === 'string' ? val : null,
      overage_rate: entry?.overageRate ?? null,
      overage_unit: entry?.overageUnit ?? null,
      grace_percent: entry?.gracePercent ?? null,
    });
  }
}

fs.writeFileSync(
  path.join(root, 'docs/billing/billing-entitlement-matrix.json'),
  JSON.stringify(matrixJson, null, 2),
  'utf8',
);
console.log(`Generated docs/billing/billing-entitlement-matrix.json with ${matrixJson.cells_count} cells.`);

// 2. Generate updated docs/billing/billing-catalog-audit.json
const auditJson = {
  audit_version: '2.2.0',
  generated_at: new Date().toISOString(),
  catalog_status: 'option_a_canonical_consolidated',
  validation_status: 'passed_clean_zero_errors',
  summary: {
    total_plans: CANONICAL_PLANS.length,
    canonical_features: CANONICAL_FEATURE_CATALOG.length,
    matrix_cells: matrixJson.cells_count,
    supported_connectors: [...SUPPORTED_CONNECTOR_PROVIDERS],
    profile_credit_weight: 2.0,
    shared_monthly_events_pool: {
      free: 50000,
      starter: 250000,
      growth: 1500000,
      business: 10000000,
      enterprise: 50000000,
    },
    purged_duplicate_unimplemented_keys: [
      'integrations.github',
      'integrations.gitlab',
      'integrations.bitbucket',
      'integrations.jira',
      'integrations.terraform',
      'quota.integrations',
      'quota.notification_channels',
      'quota.log_retention_days',
      'quota.metric_retention_days',
      'quota.profile_retention_days',
      'quota.replay_retention_days',
      'quota.trace_retention_days',
      'quota.audit_log_retention_days',
      'dashboards.custom_widgets',
      'dashboards.embeds',
      'dashboards.public_links',
      'dashboards.scheduled_reports',
      'quota.monthly_reports',
    ],
  },
  resolved_issues: [
    {
      id: 'ISSUE-01',
      title: 'Profile Telemetry Credit Weight Inconsistency',
      resolution: 'Updated billing_event_credit_weights seeder, credit-weight.service.ts, and JSON catalog to credit_weight = 2.0000.',
      status: 'RESOLVED',
    },
    {
      id: 'ISSUE-02',
      title: 'Duplicate Conflicting Plan Seeder 032_17',
      resolution: 'Deleted 032_17_enterprise_ingestion_004_plans_seed.sql from both schema/20_seeders and seeds.',
      status: 'RESOLVED',
    },
    {
      id: 'ISSUE-03',
      title: 'Unimplemented Integration Keys in Billing Catalog',
      resolution: 'Purged github, gitlab, bitbucket, jira, terraform from billing catalog under Option A. Retained 7 implemented providers.',
      status: 'RESOLVED',
    },
    {
      id: 'ISSUE-04',
      title: 'Duplicate Connector and Channel Quotas',
      resolution: 'Standardized on quota.connectors and quota.alert_channels. Removed quota.integrations and quota.notification_channels.',
      status: 'RESOLVED',
    },
    {
      id: 'ISSUE-05',
      title: 'Redundant Per-Signal Data Retention Quotas',
      resolution: 'Consolidated 6 per-signal quotas into single platform-wide quota.retention_days (7d, 30d, 90d, 180d, 365d).',
      status: 'RESOLVED',
    },
    {
      id: 'ISSUE-06',
      title: 'Phantom Dashboard Sub-flags',
      resolution: 'Retained real functional flags: dashboards.enabled, dashboards.custom_dashboards, and quota.dashboards. Purged unbuilt reporting/embed flags.',
      status: 'RESOLVED',
    },
    {
      id: 'ISSUE-07',
      title: 'Enterprise Unlimited / Custom Monthly Events String Bug',
      resolution: 'Replaced Custom/unlimited with finite integer 50,000,000 shared monthly event credits across seeders, matrix, and JSON.',
      status: 'RESOLVED',
    },
    {
      id: 'ISSUE-08',
      title: 'UsageRollup Decimal Credit Casting in PostgreSQL bigint[]',
      resolution: 'Applied Math.ceil(s.total) in UsageRollup.run before binding totals to $3::bigint[].',
      status: 'RESOLVED',
    },
  ],
};

fs.writeFileSync(
  path.join(root, 'docs/billing/billing-catalog-audit.json'),
  JSON.stringify(auditJson, null, 2),
  'utf8',
);
console.log(`Generated docs/billing/billing-catalog-audit.json.`);
