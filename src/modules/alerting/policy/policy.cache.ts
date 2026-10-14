import { LRUCache } from 'lru-cache';
import type { EffectiveAlertPolicy, PolicyResolutionResult } from './types.js';

export class AlertPolicyCache {
  private readonly cache = new LRUCache<string, PolicyResolutionResult>({ max: 5000, ttl: 30_000 });

  get(key: string): PolicyResolutionResult | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: PolicyResolutionResult): void {
    this.cache.set(key, deepFreeze(value));
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

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object') {
      deepFreeze(val);
    }
  }
  return obj;
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
