/**
 * Feature Dependency Graph & DAG Validator (v2 Engine)
 *
 * Resolves direct and transitive feature dependencies, checks reverse dependents,
 * and validates plan entitlement configurations against dependency violations.
 */

import { FEATURE_REGISTRY } from './feature-registry.js';
import type { FeatureKey, PlanKey } from './feature-registry.js';
import { PLAN_MATRIX, isFeatureEnabled, getQuotaValue } from './plan-matrix.js';

export class CircularDependencyError extends Error {
  constructor(public readonly cycle: FeatureKey[]) {
    super(`Circular dependency detected in feature registry: ${cycle.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

export interface PlanViolation {
  readonly feature: FeatureKey;
  readonly missingDependency: FeatureKey;
}

export interface PlanValidationResult {
  readonly valid: boolean;
  readonly violations: readonly PlanViolation[];
}

export class DependencyGraph {
  private readonly directDeps = new Map<FeatureKey, Set<FeatureKey>>();
  private readonly reverseDeps = new Map<FeatureKey, Set<FeatureKey>>();

  constructor() {
    this.buildGraph();
    this.detectCycles();
  }

  private buildGraph(): void {
    for (const [keyStr, feat] of Object.entries(FEATURE_REGISTRY)) {
      const key = keyStr as FeatureKey;
      if (!this.directDeps.has(key)) {
        this.directDeps.set(key, new Set());
      }
      if (!this.reverseDeps.has(key)) {
        this.reverseDeps.set(key, new Set());
      }

      if (feat.dependencies && feat.dependencies.length > 0) {
        for (const dep of feat.dependencies) {
          this.directDeps.get(key)!.add(dep);

          if (!this.reverseDeps.has(dep)) {
            this.reverseDeps.set(dep, new Set());
          }
          this.reverseDeps.get(dep)!.add(key);
        }
      }
    }
  }

  private detectCycles(): void {
    const visited = new Set<FeatureKey>();
    const recursionStack = new Set<FeatureKey>();
    const path: FeatureKey[] = [];

    const dfs = (node: FeatureKey): void => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const deps = this.directDeps.get(node) || new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          dfs(dep);
        } else if (recursionStack.has(dep)) {
          const cycleStartIdx = path.indexOf(dep);
          const cyclePath = [...path.slice(cycleStartIdx), dep];
          throw new CircularDependencyError(cyclePath);
        }
      }

      path.pop();
      recursionStack.delete(node);
    };

    for (const key of this.directDeps.keys()) {
      if (!visited.has(key)) {
        dfs(key);
      }
    }
  }

  /**
   * Returns direct feature dependencies.
   */
  public getDependencies(featureKey: FeatureKey): FeatureKey[] {
    const deps = this.directDeps.get(featureKey);
    return deps ? Array.from(deps) : [];
  }

  /**
   * Returns all transitive (recursive) dependencies in topological order.
   */
  public getAllDependencies(featureKey: FeatureKey): FeatureKey[] {
    const result: FeatureKey[] = [];
    const visited = new Set<FeatureKey>();

    const collect = (key: FeatureKey) => {
      const deps = this.directDeps.get(key);
      if (!deps) return;
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.add(dep);
          collect(dep);
          result.push(dep);
        }
      }
    };

    collect(featureKey);
    return result;
  }

  /**
   * Returns features that directly depend on the given feature (reverse lookup).
   */
  public getDependents(featureKey: FeatureKey): FeatureKey[] {
    const dependents = this.reverseDeps.get(featureKey);
    return dependents ? Array.from(dependents) : [];
  }

  /**
   * Evaluates if a feature is considered "active/enabled" under a given plan.
   * Boolean features are active if true; quota/numeric features are active if > 0 or -1 (unlimited).
   */
  private isFeatureActiveInPlan(planKey: PlanKey, featureKey: FeatureKey): boolean {
    const featDef = FEATURE_REGISTRY[featureKey];
    if (!featDef) return false;

    if (featDef.type === 'boolean') {
      return isFeatureEnabled(planKey, featureKey);
    }
    if (featDef.type === 'integer') {
      const quota = getQuotaValue(planKey, featureKey);
      return quota !== undefined && (quota > 0 || quota === -1);
    }
    return true;
  }

  /**
   * Validates a plan to ensure that every active feature has all its required dependencies active.
   */
  public validatePlan(planKey: PlanKey): PlanValidationResult {
    const violations: PlanViolation[] = [];

    for (const keyStr of Object.keys(FEATURE_REGISTRY)) {
      const featureKey = keyStr as FeatureKey;
      if (this.isFeatureActiveInPlan(planKey, featureKey)) {
        const requiredDeps = this.getAllDependencies(featureKey);
        for (const depKey of requiredDeps) {
          if (!this.isFeatureActiveInPlan(planKey, depKey)) {
            violations.push({ feature: featureKey, missingDependency: depKey });
          }
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Returns missing dependencies for a specific feature on a plan.
   */
  public getMissingDependencies(planKey: PlanKey, featureKey: FeatureKey): FeatureKey[] {
    const required = this.getAllDependencies(featureKey);
    return required.filter(depKey => !this.isFeatureActiveInPlan(planKey, depKey));
  }
}

/**
 * Singleton dependency graph instance.
 */
export const dependencyGraph = new DependencyGraph();

/** Pure function delegates for convenience */
export const getDependencies = (key: FeatureKey): FeatureKey[] => dependencyGraph.getDependencies(key);
export const getAllDependencies = (key: FeatureKey): FeatureKey[] => dependencyGraph.getAllDependencies(key);
export const getDependents = (key: FeatureKey): FeatureKey[] => dependencyGraph.getDependents(key);
export const validatePlan = (planKey: PlanKey): PlanValidationResult => dependencyGraph.validatePlan(planKey);
export const getMissingDependencies = (planKey: PlanKey, featureKey: FeatureKey): FeatureKey[] => dependencyGraph.getMissingDependencies(planKey, featureKey);

// ── UNIT TEST STUBS & EXAMPLES ─────────────────────────────────
/*
 * Example Unit Tests (Jest / Vitest syntax stubs):
 *
 * describe('DependencyGraph', () => {
 *   it('should resolve direct dependencies for sdk.remote_config', () => {
 *     expect(getDependencies('sdk.remote_config')).toEqual(['sdk.enabled']);
 *   });
 *
 *   it('should resolve transitive dependencies for sdk.dynamic_sampling', () => {
 *     const deps = getAllDependencies('sdk.dynamic_sampling');
 *     expect(deps).toContain('sdk.enabled');
 *     expect(deps).toContain('sdk.remote_config');
 *   });
 *
 *   it('should perform reverse dependent lookups for sdk.enabled', () => {
 *     const dependents = getDependents('sdk.enabled');
 *     expect(dependents).toContain('sdk.remote_config');
 *     expect(dependents).toContain('sdk.retry');
 *   });
 *
 *   it('should validate plan entitlements without dependency violations', () => {
 *     const result = validatePlan('growth');
 *     expect(result.valid).toBe(true);
 *     expect(result.violations).toHaveLength(0);
 *   });
 * });
 */
