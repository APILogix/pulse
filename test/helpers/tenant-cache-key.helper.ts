/**
 * Helper to validate that any cache key containing tenant-bound data
 * strictly contains a valid organization identifier (UUID or org identifier segment).
 */

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

export interface TenantKeyValidationOptions {
  expectedOrgId?: string;
  allowSystemScope?: boolean;
}

/**
 * Asserts that a cache key formatted for tenant data contains an organization ID.
 * Throws an AssertionError if the key is missing org_id.
 */
export function assertCacheKeyTenantScoped(
  key: string,
  options: TenantKeyValidationOptions = {},
): void {
  if (!key || typeof key !== 'string') {
    throw new Error(`[TenantScopeViolation] Cache key must be a non-empty string. Received: ${String(key)}`);
  }

  // System or global scope exceptions if explicitly configured
  if (options.allowSystemScope && (key.startsWith('system:') || key.includes(':global:'))) {
    return;
  }

  if (options.expectedOrgId) {
    if (!key.includes(options.expectedOrgId)) {
      throw new Error(
        `[TenantScopeViolation] Cache key '${key}' does not contain expected org_id '${options.expectedOrgId}'.`,
      );
    }
    return;
  }

  // Check for either a UUID segment or an explicit org: prefix
  const hasUuid = UUID_REGEX.test(key);
  const hasOrgSegment = key.includes(':org_') || key.includes('org:') || key.startsWith('org_');

  if (!hasUuid && !hasOrgSegment) {
    throw new Error(
      `[TenantScopeViolation] Cache key '${key}' lacks organization scoping. All tenant-bound cache keys must include an org_id.`,
    );
  }
}
