import fs from 'fs';
import path from 'path';
import { CANONICAL_FEATURE_CATALOG, CANONICAL_PLANS, SUPPORTED_CONNECTOR_PROVIDERS, } from './feature-registry.js';
import { CANONICAL_PLAN_MATRIX } from './plan-matrix.js';
export class BillingCatalogValidator {
    /**
     * Run full catalog validation and return report.
     */
    validate() {
        const issues = [];
        // 1. Validate Plans Completeness
        const planKeys = Object.keys(CANONICAL_PLAN_MATRIX);
        for (const plan of CANONICAL_PLANS) {
            if (!planKeys.includes(plan)) {
                issues.push({
                    severity: 'error',
                    code: 'MISSING_PLAN',
                    message: `Canonical plan '${plan}' is missing from the entitlement matrix.`,
                    planKey: plan,
                });
            }
        }
        // 2. Validate Feature Catalog Integrity
        const seenFeatureKeys = new Set();
        for (const feature of CANONICAL_FEATURE_CATALOG) {
            if (seenFeatureKeys.has(feature.key)) {
                issues.push({
                    severity: 'error',
                    code: 'DUPLICATE_FEATURE_KEY',
                    message: `Duplicate feature key '${feature.key}' in canonical feature catalog.`,
                    featureKey: feature.key,
                });
            }
            seenFeatureKeys.add(feature.key);
            if (!feature.key || !feature.name || !feature.description) {
                issues.push({
                    severity: 'error',
                    code: 'INVALID_FEATURE_METADATA',
                    message: `Feature '${feature.key}' has missing required metadata fields.`,
                    featureKey: feature.key,
                });
            }
        }
        // 3. Validate Plan x Feature Matrix Completeness & Type Safety
        let totalEntitlementsChecked = 0;
        let validEntitlementsCount = 0;
        for (const plan of CANONICAL_PLANS) {
            const planData = CANONICAL_PLAN_MATRIX[plan];
            if (!planData)
                continue;
            for (const feature of CANONICAL_FEATURE_CATALOG) {
                totalEntitlementsChecked++;
                const entry = planData.features.find(f => f.featureKey === feature.key);
                if (!entry) {
                    issues.push({
                        severity: 'error',
                        code: 'MISSING_PLAN_ENTITLEMENT',
                        message: `Plan '${plan}' has no entitlement defined for feature '${feature.key}'.`,
                        planKey: plan,
                        featureKey: feature.key,
                    });
                    continue;
                }
                const featType = feature.type;
                // Validate Type conformance
                if (featType === 'boolean') {
                    if (typeof entry.value !== 'boolean') {
                        issues.push({
                            severity: 'error',
                            code: 'INVALID_BOOLEAN_VALUE',
                            message: `Feature '${feature.key}' is boolean, but plan '${plan}' has non-boolean value.`,
                            planKey: plan,
                            featureKey: feature.key,
                        });
                    }
                    else {
                        validEntitlementsCount++;
                    }
                }
                else if (featType === 'integer') {
                    if (typeof entry.value !== 'number' || !Number.isInteger(entry.value)) {
                        issues.push({
                            severity: 'error',
                            code: 'INVALID_INTEGER_VALUE',
                            message: `Quota '${feature.key}' is integer, but plan '${plan}' has non-integer value.`,
                            planKey: plan,
                            featureKey: feature.key,
                        });
                    }
                    else {
                        // Validate unlimited rule: -1 is only allowed if supportsUnlimited = true
                        if (entry.value === -1 && !feature.supportsUnlimited) {
                            issues.push({
                                severity: 'error',
                                code: 'UNSUPPORTED_UNLIMITED_VALUE',
                                message: `Quota '${feature.key}' does not support unlimited (-1), but plan '${plan}' has -1.`,
                                planKey: plan,
                                featureKey: feature.key,
                            });
                        }
                        else if (entry.value < -1) {
                            issues.push({
                                severity: 'error',
                                code: 'NEGATIVE_QUOTA_VALUE',
                                message: `Quota '${feature.key}' has invalid negative value (${entry.value}) on plan '${plan}'.`,
                                planKey: plan,
                                featureKey: feature.key,
                            });
                        }
                        else {
                            validEntitlementsCount++;
                        }
                    }
                }
                else {
                    validEntitlementsCount++;
                }
            }
        }
        // 4. Validate Numeric Quota Monotonicity across Tiers: Free <= Starter <= Growth <= Business <= Enterprise
        let monotonicityPassed = true;
        const tierOrder = ['free', 'starter', 'growth', 'business', 'enterprise'];
        for (const feature of CANONICAL_FEATURE_CATALOG) {
            if (feature.type !== 'integer' || feature.category !== 'quota')
                continue;
            let previousVal = null;
            let previousPlan = null;
            for (const plan of tierOrder) {
                const planData = CANONICAL_PLAN_MATRIX[plan];
                const entry = planData?.features.find(f => f.featureKey === feature.key);
                if (!entry || typeof entry.value !== 'number')
                    continue;
                const currentVal = entry.value;
                // Skip comparison if either is unlimited (-1)
                if (previousVal !== null && previousVal !== -1 && currentVal !== -1) {
                    if (currentVal < previousVal) {
                        monotonicityPassed = false;
                        issues.push({
                            severity: 'error',
                            code: 'MONOTONICITY_REGRESSION',
                            message: `Monotonicity violation for '${feature.key}': plan '${plan}' (${currentVal}) is lower than '${previousPlan}' (${previousVal}).`,
                            featureKey: feature.key,
                            planKey: plan,
                            details: { previousPlan, previousVal, currentPlan: plan, currentVal },
                        });
                    }
                }
                previousVal = currentVal;
                previousPlan = plan;
            }
        }
        // 5. Validate Finite Connector Catalog
        for (const provider of SUPPORTED_CONNECTOR_PROVIDERS) {
            const integrationKey = `integrations.${provider}`;
            const feature = CANONICAL_FEATURE_CATALOG.find((f) => f.key === integrationKey);
            if (!feature) {
                issues.push({
                    severity: 'error',
                    code: 'MISSING_PROVIDER_FEATURE',
                    message: `Supported connector provider '${provider}' is missing integration feature key '${integrationKey}'.`,
                    featureKey: integrationKey,
                });
            }
        }
        const errorsCount = issues.filter((i) => i.severity === 'error').length;
        const warningsCount = issues.filter((i) => i.severity === 'warning').length;
        const matrixCompletenessPercent = totalEntitlementsChecked > 0
            ? Math.round((validEntitlementsCount / totalEntitlementsChecked) * 100)
            : 100;
        return {
            timestamp: new Date().toISOString(),
            totalPlans: CANONICAL_PLANS.length,
            totalFeatures: CANONICAL_FEATURE_CATALOG.length,
            totalEntitlementsChecked,
            supportedConnectorsCount: SUPPORTED_CONNECTOR_PROVIDERS.length,
            supportedConnectors: [...SUPPORTED_CONNECTOR_PROVIDERS],
            issues,
            isValid: errorsCount === 0,
            summary: {
                errorsCount,
                warningsCount,
                monotonicityPassed,
                matrixCompletenessPercent,
            },
        };
    }
    /**
     * Validate and export machine-readable report to a file.
     */
    generateReportFile(outputPath) {
        const report = this.validate();
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
        return report;
    }
}
export const catalogValidator = new BillingCatalogValidator();
//# sourceMappingURL=catalog-validator.js.map