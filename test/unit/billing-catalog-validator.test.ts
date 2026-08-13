import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  CANONICAL_FEATURE_CATALOG,
  CANONICAL_PLANS,
  SUPPORTED_CONNECTOR_PROVIDERS,
  getFeatureDefinition,
} from '../../src/modules/billing/catalog/feature-registry.js';
import { CANONICAL_PLAN_MATRIX } from '../../src/modules/billing/catalog/plan-matrix.js';
import { BillingCatalogValidator } from '../../src/modules/billing/catalog/catalog-validator.js';
import { listConnectorTypes } from '../../src/modules/connectors/registry.js';

describe('Enterprise Billing Catalog & Seeder Contract Validation (Req 63-97)', () => {
  const validator = new BillingCatalogValidator();

  describe('Plan Catalog Completeness', () => {
    it('contains all 5 canonical tiers with no omissions', () => {
      const expectedPlans = ['free', 'starter', 'growth', 'business', 'enterprise'];
      expect(CANONICAL_PLANS).toEqual(expectedPlans);

      for (const plan of expectedPlans) {
        expect(CANONICAL_PLAN_MATRIX).toHaveProperty(plan);
      }
    });
  });

  describe('Finite Connector Provider Inventory', () => {
    it('has exactly 7 supported connector providers registered in runtime code', () => {
      const runtimeTypes = listConnectorTypes().map((t) => t.type);
      expect(runtimeTypes).toHaveLength(7);
      expect(SUPPORTED_CONNECTOR_PROVIDERS).toHaveLength(7);

      for (const provider of SUPPORTED_CONNECTOR_PROVIDERS) {
        expect(runtimeTypes).toContain(provider === 'microsoft_teams' ? 'teams' : provider);
      }
    });

    it('has explicit boolean entitlements for all 7 providers across all 5 plans (no NULLs, no wildcards)', () => {
      for (const plan of CANONICAL_PLANS) {
        for (const provider of SUPPORTED_CONNECTOR_PROVIDERS) {
          const key = `integrations.${provider}`;
          const entry = CANONICAL_PLAN_MATRIX[plan][key];
          expect(entry).toBeDefined();
          expect(typeof entry?.booleanValue).toBe('boolean');
        }
      }
    });

    it('keeps connector instance quota finite and separate from provider type access', () => {
      for (const plan of CANONICAL_PLANS) {
        const connectorQuota = CANONICAL_PLAN_MATRIX[plan]['quota.connectors'];
        expect(connectorQuota).toBeDefined();
        expect(typeof connectorQuota?.integerValue).toBe('number');
        expect(connectorQuota?.integerValue).toBeGreaterThan(0);
      }
    });
  });

  describe('Alerting Surface Completeness (Org & Per-Project Rules, Channels, Routing, Meters)', () => {
    it('defines and seeds all required alerting capability and quota dimensions', () => {
      const requiredAlertingKeys = [
        'alerting.enabled',
        'alerting.routing.enabled',
        'quota.alert_rules',
        'quota.project_alert_rules',
        'quota.alert_channels',
        'quota.routing_rules',
        'quota.daily_alerts',
        'quota.monthly_alerts',
        'quota.connector_sends',
      ];

      for (const key of requiredAlertingKeys) {
        const def = getFeatureDefinition(key);
        expect(def, `Missing feature definition for ${key}`).toBeDefined();

        for (const plan of CANONICAL_PLANS) {
          const planVal = CANONICAL_PLAN_MATRIX[plan][key];
          expect(planVal, `Missing plan value for ${plan} -> ${key}`).toBeDefined();
        }
      }
    });

    it('enforces per-project alert rules quota <= organization alert rules quota', () => {
      for (const plan of CANONICAL_PLANS) {
        const orgRules = CANONICAL_PLAN_MATRIX[plan]['quota.alert_rules']?.integerValue ?? 0;
        const projectRules = CANONICAL_PLAN_MATRIX[plan]['quota.project_alert_rules']?.integerValue ?? 0;

        if (orgRules !== -1 && projectRules !== -1) {
          expect(projectRules).toBeLessThanOrEqual(orgRules);
        }
      }
    });
  });

  describe('Catalog Validation Engine & Report Generation', () => {
    it('passes comprehensive catalog validation with 0 errors', () => {
      const report = validator.validate();

      if (!report.isValid) {
        // Output issues for debugging
        console.error('Validation issues:', report.issues);
      }

      expect(report.isValid).toBe(true);
      expect(report.summary.errorsCount).toBe(0);
      expect(report.summary.monotonicityPassed).toBe(true);
      expect(report.summary.matrixCompletenessPercent).toBe(100);
      expect(report.totalPlans).toBe(5);
      expect(report.supportedConnectorsCount).toBe(7);
    });

    it('generates machine-readable billing-catalog-report.json file', () => {
      const reportPath = path.resolve(process.cwd(), 'billing-catalog-report.json');
      const report = validator.generateReportFile(reportPath);

      expect(fs.existsSync(reportPath)).toBe(true);
      const fileContent = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      expect(fileContent.isValid).toBe(true);
      expect(fileContent.summary.errorsCount).toBe(0);
    });
  });
});
