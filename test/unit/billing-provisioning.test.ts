import { describe, expect, it, vi } from 'vitest';

import { BillingProvisioningRepository } from '../../src/modules/billing/provisioning/repository.js';

function sqlText(sql: unknown): string {
  return Array.isArray(sql) ? sql.join('') : String(sql);
}

function createClient(featureRows: Array<Record<string, unknown>>) {
  const query = vi.fn(async (sql: unknown) => {
    const text = sqlText(sql);
    if (text.includes('FROM plans')) {
      return { rows: [{ id: 'plan-free', key: 'free', version: 2, tier: 'free', trial_days: 14 }] };
    }
    if (text.includes('FROM plan_feature_entitlements')) {
      return { rows: featureRows };
    }
    if (text.includes('FROM plan_prices')) {
      return {
        rows: [
          {
            id: 'price-free-monthly',
            provider: 'system',
            billing_interval: 'monthly',
            currency: 'USD',
            amount_minor: 0,
            provider_price_id: null,
          },
        ],
      };
    }
    if (text.includes('SELECT') && text.includes('period_start')) {
      return {
        rows: [
          {
            period_start: new Date('2026-07-26T00:00:00.000Z'),
            period_end: new Date('2026-08-09T00:00:00.000Z'),
          },
        ],
      };
    }
    if (text.includes('INSERT INTO organization_subscriptions')) {
      return { rows: [{ id: 'sub-free' }] };
    }
    return { rows: [] };
  });
  return { query } as any;
}

const validFeatureRows = [
  {
    feature_key: 'monthly_events',
    module: 'observability',
    is_module_root: false,
    value_type: 'integer',
    boolean_value: null,
    integer_value: 10000,
    decimal_value: null,
    string_value: null,
  },
  {
    feature_key: 'module_ai_insights_monthly_credits',
    module: 'ai',
    is_module_root: false,
    value_type: 'integer',
    boolean_value: null,
    integer_value: 100,
    decimal_value: null,
    string_value: null,
  },
  {
    feature_key: 'alerting',
    module: 'observability',
    is_module_root: true,
    value_type: 'boolean',
    boolean_value: true,
    integer_value: null,
    decimal_value: null,
    string_value: null,
  },
];

describe('BillingProvisioningRepository', () => {
  it('provisions org billing state from the free plan entitlement seed', async () => {
    const client = createClient(validFeatureRows);
    const repository = new BillingProvisioningRepository();

    const result = await repository.provisionFreeSubscription(client, 'org-1');

    expect(result).toEqual({
      subscriptionId: 'sub-free',
      planId: 'plan-free',
      status: 'trialing',
      featureCount: 3,
      eventLimit: 10000,
      aiCreditLimit: 100,
    });

    const subscriptionCall = client.query.mock.calls.find(([sql]: [unknown]) =>
      sqlText(sql).includes('INSERT INTO organization_subscriptions'),
    );
    expect(subscriptionCall).toBeTruthy();
    expect(JSON.parse(subscriptionCall![1][6])).toMatchObject({
      observability: {
        enabled: true,
        features: {
          monthly_events: 10000,
          alerting: true,
        },
      },
          ai: {
            features: {
            module_ai_insights_monthly_credits: 100,
            },
          },
    });

    const usageCall = client.query.mock.calls.find(([sql]: [unknown]) =>
      sqlText(sql).includes('INSERT INTO organization_usage_current_period'),
    );
    expect(usageCall).toBeTruthy();
    expect(usageCall![1][4]).toBe(10000);
    expect(usageCall![1][5]).toBe(100);

    expect(client.query.mock.calls.some(([sql]: [unknown]) => sqlText(sql).includes('INSERT INTO billing_audit_logs'))).toBe(true);
  });

  it('fails fast when the free plan seed is missing required usage features', async () => {
    const client = createClient(validFeatureRows.filter((row) => row.feature_key !== 'module_ai_insights_monthly_credits'));
    const repository = new BillingProvisioningRepository();

    await expect(repository.provisionFreeSubscription(client, 'org-1')).rejects.toThrow(
      'Free billing plan entitlement module_ai_insights_monthly_credits',
    );
  });
});
