import { describe, expect, it, vi } from 'vitest';
import { AlertEntitlementGuard } from '../../src/modules/alerting/entitlements/guard.js';

describe('alert entitlements', () => {
  const logger = { child: () => ({ warn: vi.fn(), error: vi.fn() }) } as never;

  it('allows report-only decisions without hiding the denial reason', async () => {
    const repository = { hasFeature: vi.fn().mockResolvedValue(false) } as never;
    const result = await new AlertEntitlementGuard(logger, repository).check('org', 'alerts', 'warning', true);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('not_entitled');
  });

  it('allows critical alerts when entitlement lookup is unavailable', async () => {
    const repository = { hasFeature: vi.fn().mockRejectedValue(new Error('db unavailable')) } as never;
    const result = await new AlertEntitlementGuard(logger, repository).check('org', 'alerts', 'critical', false);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('unknown_critical_allow');
  });

  it('denies non-critical alerts when entitlement lookup is unavailable', async () => {
    const repository = { hasFeature: vi.fn().mockRejectedValue(new Error('db unavailable')) } as never;
    const result = await new AlertEntitlementGuard(logger, repository).check('org', 'alerts', 'warning', false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('unknown_noncritical_deny');
  });
});
