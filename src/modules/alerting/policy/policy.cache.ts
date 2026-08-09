import { LRUCache } from 'lru-cache';
import type { EffectiveAlertPolicy, PolicyResolutionResult } from './types.js';

export class AlertPolicyCache {
  private readonly cache = new LRUCache<string, PolicyResolutionResult>({ max: 5000, ttl: 30_000 });

  get(key: string): PolicyResolutionResult | undefined {
    const value = this.cache.get(key);
    return value ? cloneResult(value) : undefined;
  }

  set(key: string, value: PolicyResolutionResult): void {
    this.cache.set(key, cloneResult(value));
  }

  deleteByRule(ruleId: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(`:${ruleId}:`)) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

function cloneResult(value: PolicyResolutionResult): PolicyResolutionResult {
  return structuredClone(value) as PolicyResolutionResult;
}

export function policyCacheKey(
  organizationId: string,
  ruleId: string,
  version: number,
  scope: { projectId?: string | null; environment?: string | null; service?: string | null; endpoint?: string | null },
  options: { requireProjectSubscription?: boolean } = {},
): string {
  return [organizationId, ruleId, version, options.requireProjectSubscription === true ? 'strict' : 'compat', scope.projectId ?? '', scope.environment ?? '', scope.service ?? '', scope.endpoint ?? ''].join(':');
}
