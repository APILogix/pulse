/**
 * Plan-to-Feature Entitlement Matrix
 *
 * Defines plan metadata and entitlement values for all 5 platform plans.
 * Auto-generated from canonical catalog version 2.0.
 */
import type { FeatureKey, PlanKey } from './feature-registry.js';
export type { PlanKey };
export interface PlanPrice {
    readonly id: string;
    readonly provider: 'stripe' | 'system' | string;
    readonly interval: 'monthly' | 'annual' | string;
    readonly currency: string;
    readonly amountMinor: number;
    readonly isDefault: boolean;
    readonly metadata: Readonly<Record<string, unknown>>;
}
export interface PlanDefinition {
    readonly id: string;
    readonly key: PlanKey;
    readonly name: string;
    readonly tier: PlanKey;
    readonly description: string;
    readonly trialDays: number;
    readonly sortOrder: number;
    readonly isPublic: boolean;
    readonly isCustomizable: boolean;
    readonly nextPlanKey: PlanKey | null;
    readonly badge: string | null;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly prices: readonly PlanPrice[];
}
export interface PlanFeatureValue {
    readonly featureKey: FeatureKey;
    readonly value: boolean | number | string | null;
    readonly booleanValue?: boolean | null;
    readonly integerValue?: number | null;
    readonly stringValue?: string | null;
    readonly overageRate?: number;
    readonly overageUnit?: number;
    readonly gracePercent?: number;
    readonly dependencies?: readonly FeatureKey[];
}
export declare class PlanNotFoundError extends Error {
    readonly planKey: string;
    constructor(planKey: string);
}
export interface PlanEntitlementEntry {
    readonly plan: PlanDefinition;
    readonly features: readonly PlanFeatureValue[];
    readonly [key: string]: any;
}
/**
 * Authoritative Plan Entitlement Matrix mapping each plan to its canonical feature values.
 */
export declare const PLAN_MATRIX: Readonly<Record<PlanKey, PlanEntitlementEntry>>;
export declare const CANONICAL_PLAN_MATRIX: Readonly<Record<PlanKey, PlanEntitlementEntry>>;
/**
 * Returns all feature values configured for a plan.
 */
export declare function getPlanFeatures(planKey: PlanKey): PlanFeatureValue[];
/**
 * Returns the configured entitlement value for a specific plan and feature.
 */
export declare function getFeatureValue(planKey: PlanKey, featureKey: FeatureKey): PlanFeatureValue | undefined;
/**
 * Checks if a boolean feature is enabled (true) on a plan.
 */
export declare function isFeatureEnabled(planKey: PlanKey, featureKey: FeatureKey): boolean;
/**
 * Returns the integer numeric quota value for a feature on a plan, if defined.
 * If value is -1 (unlimited) or an integer, it returns that number.
 */
export declare function getQuotaValue(planKey: PlanKey, featureKey: FeatureKey): number | undefined;
/**
 * Compares two plans and returns array of feature keys whose values/limits differ.
 */
export declare function comparePlans(from: PlanKey, to: PlanKey): FeatureKey[];
//# sourceMappingURL=plan-matrix.d.ts.map