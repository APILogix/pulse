import { expect, it, vi } from 'vitest';
import { BackpressureGauge } from '../../src/lib/gauge.js';

it('reads PGMQ depth with one SQL statement and no malformed parameter argument', async () => {
  const query = vi.fn(async () => ({ rows: [{ pending_depth: '42' }] }));
  const gauge = new BackpressureGauge({ query });
  expect(await gauge.read()).toMatchObject({ pendingDepth: 42, updatedAt: expect.any(Date) });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM pgmq.metrics_all()'));
  expect(query.mock.calls[0]).toHaveLength(1);
});
