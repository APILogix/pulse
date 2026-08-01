import { describe, expect, it } from 'vitest';
import { tierForFieldPath } from '../../src/modules/alerting/runtime/rule-catalog.js';

describe('alert runtime rule catalog', () => {
  it('classifies instant event dependencies', () => {
    expect(tierForFieldPath('errors.unhandled')).toBe('fast');
    expect(tierForFieldPath('errors.fatal')).toBe('fast');
    expect(tierForFieldPath('logs.oom')).toBe('fast');
    expect(tierForFieldPath('cron.failed')).toBe('fast');
    expect(tierForFieldPath('logs.security')).toBe('fast');
    expect(tierForFieldPath('heartbeat.lost')).toBe('fast');
    expect(tierForFieldPath('deployment.failed')).toBe('fast');
    expect(tierForFieldPath('connector.failure')).toBe('fast');
  });

  it('classifies short-window rollup dependencies', () => {
    expect(tierForFieldPath('errors.rate')).toBe('window');
    expect(tierForFieldPath('requests.5xx_rate')).toBe('window');
    expect(tierForFieldPath('requests.latency.p95')).toBe('window');
    expect(tierForFieldPath('ai.requests.failed')).toBe('window');
    expect(tierForFieldPath('cron.failure_rate')).toBe('window');
    expect(tierForFieldPath('ai.failure_rate')).toBe('window');
  });

  it('classifies operational and expensive AI dependencies', () => {
    expect(tierForFieldPath('metrics.cpu.usage')).toBe('operational');
    expect(tierForFieldPath('metrics.memory.usage')).toBe('operational');
    expect(tierForFieldPath('queue.backlog')).toBe('operational');
    expect(tierForFieldPath('service.health')).toBe('operational');
    expect(tierForFieldPath('endpoint.health')).toBe('operational');
    expect(tierForFieldPath('ai.cost.usd')).toBe('ai');
    expect(tierForFieldPath('ai.credits.used')).toBe('ai');
  });
});
