import { describe, expect, it } from 'vitest';
import { alertFingerprint } from '../../src/modules/alerting/decision/decision.engine.js';

describe('alert decision fingerprinting', () => {
  const base = {
    organizationId: 'org',
    projectId: 'project',
    environment: 'production',
    service: 'api',
    endpoint: '/payments',
    dimension: '5xx',
    policy: { policyId: 'policy:v1' },
  } as never;

  it('is deterministic and scoped to the complete tenant context', () => {
    expect(alertFingerprint(base)).toBe(alertFingerprint({ ...base }));
    expect(alertFingerprint(base)).not.toBe(alertFingerprint({ ...base, service: 'worker' }));
    expect(alertFingerprint(base)).not.toBe(alertFingerprint({ ...base, organizationId: 'other-org' }));
  });
});
