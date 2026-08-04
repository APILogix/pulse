import { describe, expect, it } from 'vitest';
import { correlationKey, digestCount, isNotificationSuppressed } from '../../src/modules/alerting/preferences/preferences.js';

describe('alert preferences and correlation', () => {
  it('suppresses vacation and temporary mute windows', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    expect(isNotificationSuppressed({ enabled: true, vacationUntil: new Date('2026-01-02T00:00:00Z') }, now)).toBe(true);
    expect(isNotificationSuppressed({ enabled: true, temporaryMuteUntil: new Date('2026-01-01T13:00:00Z') }, now)).toBe(true);
    expect(isNotificationSuppressed({ enabled: true }, now)).toBe(false);
  });

  it('creates scoped correlation keys and collapses digest items', () => {
    const key = correlationKey({ organizationId: 'org', projectId: 'project', policyId: 'policy', environment: 'prod', service: 'api' });
    expect(key).toContain('org:project:policy:prod:api');
    expect(digestCount(5)).toEqual({ collapsed: true, included: 5 });
    expect(digestCount(25)).toEqual({ collapsed: true, included: 20 });
  });
});
