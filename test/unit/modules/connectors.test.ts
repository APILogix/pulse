/**
 * Unit tests for connector pure logic: rate limiter, circuit breaker, backoff,
 * webhook signing, and per-connector config validation schemas.
 *
 * These tests intentionally avoid any DB/env/network dependency so they run
 * fast and deterministically.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkRateLimit,
  circuitAllows,
  recordCircuitFailure,
  recordCircuitSuccess,
  getCircuitState,
  computeBackoffMs,
} from '../../../src/modules/connectors/runtime.js';
import { WebhookConnector } from '../../../src/modules/connectors/providers/webhook/webhook.connector.js';
import {
  SlackConfigSchema,
  DiscordConfigSchema,
  PagerDutyConfigSchema,
  TeamsConfigSchema,
  WebhookConfigSchema,
  SmsConfigSchema,
  CreateConnectorSchema,
  CreateConnectorRouteSchema,
  SendTestNotificationSchema,
} from '../../../src/modules/connectors/types.js';

describe('runtime: sliding-window rate limiter', () => {
  it('allows up to the limit then blocks within the window', () => {
    const key = `rl-${Math.random()}`;
    const limit = 3;
    expect(checkRateLimit(key, limit, 60).allowed).toBe(true);
    expect(checkRateLimit(key, limit, 60).allowed).toBe(true);
    expect(checkRateLimit(key, limit, 60).allowed).toBe(true);
    const blocked = checkRateLimit(key, limit, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills after the window elapses', () => {
    vi.useFakeTimers();
    try {
      const key = `rl-time-${Math.random()}`;
      expect(checkRateLimit(key, 1, 1).allowed).toBe(true);
      expect(checkRateLimit(key, 1, 1).allowed).toBe(false);
      vi.advanceTimersByTime(1100);
      expect(checkRateLimit(key, 1, 1).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('runtime: circuit breaker', () => {
  beforeEach(() => {
    // fresh key per test via random suffix
  });

  it('opens after the failure threshold and blocks calls', () => {
    const key = `cb-${Math.random()}`;
    expect(circuitAllows(key, { failureThreshold: 3 })).toBe(true);
    recordCircuitFailure(key, { failureThreshold: 3 });
    recordCircuitFailure(key, { failureThreshold: 3 });
    expect(getCircuitState(key)).toBe('closed');
    recordCircuitFailure(key, { failureThreshold: 3 });
    expect(getCircuitState(key)).toBe('open');
    expect(circuitAllows(key, { failureThreshold: 3, resetTimeoutMs: 60_000 })).toBe(false);
  });

  it('half-opens after the reset timeout and closes on success', () => {
    vi.useFakeTimers();
    try {
      const key = `cb-reset-${Math.random()}`;
      recordCircuitFailure(key, { failureThreshold: 1 });
      expect(getCircuitState(key)).toBe('open');
      vi.advanceTimersByTime(31_000);
      expect(circuitAllows(key, { resetTimeoutMs: 30_000 })).toBe(true);
      expect(getCircuitState(key)).toBe('half_open');
      recordCircuitSuccess(key);
      expect(getCircuitState(key)).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('runtime: exponential backoff', () => {
  it('grows with attempt count and respects the cap', () => {
    const base = 1000;
    const mult = 2;
    const a1 = computeBackoffMs(1, base, mult, 300_000);
    const a5 = computeBackoffMs(5, base, mult, 300_000);
    // Full jitter means values are random within a growing ceiling; assert the
    // ceiling grows by sampling the max over several draws.
    const max1 = Math.max(...Array.from({ length: 50 }, () => computeBackoffMs(1, base, mult)));
    const max5 = Math.max(...Array.from({ length: 50 }, () => computeBackoffMs(5, base, mult)));
    expect(a1).toBeGreaterThanOrEqual(250);
    expect(a5).toBeGreaterThanOrEqual(250);
    expect(max5).toBeGreaterThan(max1);
  });

  it('never exceeds the cap', () => {
    const capped = Math.max(...Array.from({ length: 100 }, () => computeBackoffMs(20, 1000, 2, 5000)));
    expect(capped).toBeLessThanOrEqual(5000);
  });
});

describe('webhook signature', () => {
  it('produces a deterministic HMAC-SHA256 signature for a given secret/body/ts', () => {
    const sig1 = WebhookConnector.signBody('topsecret', '{"a":1}', 1_700_000_000);
    const sig2 = WebhookConnector.signBody('topsecret', '{"a":1}', 1_700_000_000);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^t=1700000000,v1=[a-f0-9]{64}$/);
  });

  it('changes when the secret changes', () => {
    const a = WebhookConnector.signBody('secret-a', 'body', 1);
    const b = WebhookConnector.signBody('secret-b', 'body', 1);
    expect(a).not.toBe(b);
  });
});

describe('connector config validation', () => {
  it('accepts a valid Slack webhook config', () => {
    const r = SlackConfigSchema.safeParse({ webhookUrl: 'https://hooks.slack.com/services/T/B/X' });
    expect(r.success).toBe(true);
  });

  it('rejects a Slack config with neither webhook nor bot token', () => {
    const r = SlackConfigSchema.safeParse({ defaultChannel: '#alerts' });
    expect(r.success).toBe(false);
  });

  it('requires a discord-looking webhook url', () => {
    expect(DiscordConfigSchema.safeParse({ webhookUrl: 'https://discord.com/api/webhooks/1/abc' }).success).toBe(true);
    expect(DiscordConfigSchema.safeParse({ webhookUrl: 'https://example.com/hook' }).success).toBe(false);
    expect(DiscordConfigSchema.safeParse({ webhookUrl: 'http://discord.com/api/webhooks/1/abc' }).success).toBe(false);
  });

  it('requires Teams webhook urls to use HTTPS', () => {
    expect(TeamsConfigSchema.safeParse({ webhookUrl: 'https://example.webhook.office.com/hook' }).success).toBe(true);
    expect(TeamsConfigSchema.safeParse({ webhookUrl: 'http://example.webhook.office.com/hook' }).success).toBe(false);
  });

  it('requires a PagerDuty routing key', () => {
    expect(PagerDutyConfigSchema.safeParse({ routingKey: 'R0123456789' }).success).toBe(true);
    expect(PagerDutyConfigSchema.safeParse({}).success).toBe(false);
  });

  it('defaults webhook method to POST and validates url', () => {
    const r = WebhookConfigSchema.safeParse({ url: 'https://example.com/hook' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.method).toBe('POST');
    expect(WebhookConfigSchema.safeParse({ url: 'not-a-url' }).success).toBe(false);
    expect(WebhookConfigSchema.safeParse({ url: 'http://example.com/hook' }).success).toBe(false);
  });

  it('requires twilio credentials and at least one recipient', () => {
    expect(SmsConfigSchema.safeParse({
      accountSid: 'AC123', authToken: 'tok', fromNumber: '+1', toNumbers: ['+2'],
    }).success).toBe(true);
    expect(SmsConfigSchema.safeParse({
      accountSid: 'AC123', authToken: 'tok', fromNumber: '+1', toNumbers: [],
    }).success).toBe(false);
  });

  it('validates optional connector route environment filters', () => {
    expect(CreateConnectorRouteSchema.safeParse({
      eventType: 'incident.created',
      environment: 'staging',
    }).success).toBe(true);
    expect(CreateConnectorRouteSchema.safeParse({
      eventType: 'incident.created',
      environment: 'qa',
    }).success).toBe(false);
  });

  it('rejects unknown provider config keys instead of stripping them', () => {
    expect(SlackConfigSchema.safeParse({
      webhookUrl: 'https://hooks.slack.com/services/T/B/X',
      unexpected: 'silently-dropped',
    }).success).toBe(false);
    expect(WebhookConfigSchema.safeParse({
      url: 'https://example.com/hook',
      unsupportedOption: true,
    }).success).toBe(false);
  });

  it('rejects unknown connector request fields', () => {
    expect(CreateConnectorSchema.safeParse({
      name: 'alerts',
      type: 'webhook',
      config: { url: 'https://example.com/hook' },
      extraTopLevel: true,
    }).success).toBe(false);
    expect(SendTestNotificationSchema.safeParse({
      title: 'Test',
      body: 'Body',
      fields: [{ label: 'Region', value: 'us', unknown: 'x' }],
    }).success).toBe(false);
  });
});
