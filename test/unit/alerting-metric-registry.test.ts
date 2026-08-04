import { describe, expect, it } from 'vitest';
import { evaluateMetric, isSupportedWindow } from '../../src/modules/alerting/evaluation/metric-registry.js';

describe('alert metric registry', () => {
  const now = new Date('2026-01-01T00:00:30Z');
  const context = {
    series: {
      value: [
        { value: 2, occurredAt: new Date('2026-01-01T00:00:05Z') },
        { value: 4, occurredAt: new Date('2026-01-01T00:00:20Z') },
      ],
      denominator: [{ value: 10, occurredAt: new Date('2026-01-01T00:00:20Z') }],
    },
  };

  it('supports windows, rates, percentages, averages, counts and ratios', () => {
    expect(evaluateMetric({ aggregation: 'count', windowSeconds: 30 }, context, now).value).toBe(2);
    expect(evaluateMetric({ aggregation: 'moving_average', windowSeconds: 30 }, context, now).value).toBe(3);
    expect(evaluateMetric({ aggregation: 'rate', windowSeconds: 30 }, context, now).value).toBe(0.2);
    expect(evaluateMetric({ aggregation: 'percentage', numerator: 'value', denominator: 'denominator', windowSeconds: 30 }, context, now).value).toBe(60);
    expect(evaluateMetric({ aggregation: 'ratio', numerator: 'value', denominator: 'denominator', windowSeconds: 30 }, context, now).value).toBe(0.6);
  });

  it('accepts only configured evaluation tiers', () => {
    expect(isSupportedWindow(5)).toBe(true);
    expect(isSupportedWindow(10)).toBe(false);
  });
});
