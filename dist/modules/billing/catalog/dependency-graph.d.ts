/**
 * Feature Dependency Graph & DAG Validator (v2 Engine)
 *
 * Resolves direct and transitive feature dependencies, checks reverse dependents,
 * and validates plan entitlement configurations against dependency violations.
 */
import type { FeatureKey, PlanKey } from './feature-registry.js';
export declare class CircularDependencyError extends Error {
    readonly cycle: FeatureKey[];
    constructor(cycle: FeatureKey[]);
}
export interface PlanViolation {
    readonly feature: FeatureKey;
    readonly missingDependency: FeatureKey;
}
export interface PlanValidationResult {
    readonly valid: boolean;
    readonly violations: readonly PlanViolation[];
}
export declare class DependencyGraph {
    private readonly directDeps;
    private readonly reverseDeps;
    constructor();
    private buildGraph;
    private detectCycles;
    /**
     * Returns direct feature dependencies.
     */
    getDependencies(featureKey: FeatureKey): FeatureKey[];
    /**
     * Returns all transitive (recursive) dependencies in topological order.
     */
    getAllDependencies(featureKey: FeatureKey): FeatureKey[];
    /**
     * Returns features that directly depend on the given feature (reverse lookup).
     */
    getDependents(featureKey: FeatureKey): FeatureKey[];
    /**
     * Evaluates if a feature is considered "active/enabled" under a given plan.
     * Boolean features are active if true; quota/numeric features are active if > 0 or -1 (unlimited).
     */
    private isFeatureActiveInPlan;
    /**
     * Validates a plan to ensure that every active feature has all its required dependencies active.
     */
    validatePlan(planKey: PlanKey): PlanValidationResult;
    /**
     * Returns missing dependencies for a specific feature on a plan.
     */
    getMissingDependencies(planKey: PlanKey, featureKey: FeatureKey): FeatureKey[];
}
/**
 * Singleton dependency graph instance.
 */
export declare const dependencyGraph: DependencyGraph;
/** Pure function delegates for convenience */
export declare const getDependencies: (key: FeatureKey) => FeatureKey[];
export declare const getAllDependencies: (key: FeatureKey) => FeatureKey[];
export declare const getDependents: (key: FeatureKey) => FeatureKey[];
export declare const validatePlan: (planKey: PlanKey) => PlanValidationResult;
export declare const getMissingDependencies: (planKey: PlanKey, featureKey: FeatureKey) => FeatureKey[];
//# sourceMappingURL=dependency-graph.d.ts.map