import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertAutoResolveSweep } from '../../src/modules/alerting/runtime/auto-resolve-sweep.js';
import { AlertRuntimeRepository } from '../../src/modules/alerting/runtime/alert-runtime.repository.js';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

const ORG = '00000000-0000-4000-8000-000000000001';

function logger(): FastifyBaseLogger {
  const log: any = {
    trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
    child: () => log,
  };
  return log as FastifyBaseLogger;
}

function alertRow(key: string) {
  return {
    alert_key: key,
    organization_id: ORG,
    project_id: '00000000-0000-4000-8000-000000000002',
    latest_event_id: '00000000-0000-4000-8000-000000000003',
    severity: 'critical',
  };
}

describe('AlertAutoResolveSweep', () => {
  let claimAutoResolvableAlerts: ReturnType<typeof vi.fn>;
  let appendHistory: ReturnType<typeof vi.fn>;
  let runtime: AlertRuntimeRepository;

  beforeEach(() => {
    claimAutoResolvableAlerts = vi.fn().mockResolvedValue([]);
    appendHistory = vi.fn().mockResolvedValue(undefined);
    runtime = { claimAutoResolvableAlerts, appendHistory } as unknown as AlertRuntimeRepository;
  });

  it('resolves each claimed alert and writes an audit history row', async () => {
    claimAutoResolvableAlerts.mockResolvedValue([alertRow('a'), alertRow('b')]);
    const sweep = new AlertAutoResolveSweep({} as Pool, logger(), runtime);

    const result = await sweep.run(200);

    expect(result).toEqual({ claimed: 2, resolved: 2, failed: 0 });
    expect(appendHistory).toHaveBeenCalledTimes(2);
    // The history row must record that this was a TIMEOUT, not a verified
    // recovery - otherwise operators cannot tell the two apart after the fact.
    expect(appendHistory).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG,
      action: 'auto_resolved',
      actorType: 'worker',
      previousState: 'firing',
      newState: 'resolved',
      metadata: expect.objectContaining({ verifiedRecovery: false }),
    }));
  });

  it('is a no-op when nothing is due', async () => {
    const sweep = new AlertAutoResolveSweep({} as Pool, logger(), runtime);
    const result = await sweep.run(200);

    expect(result).toEqual({ claimed: 0, resolved: 0, failed: 0 });
    expect(appendHistory).not.toHaveBeenCalled();
  });

  it('does not un-resolve an alert when its audit history append fails', async () => {
    // The state transition has already committed inside the claim statement, so a
    // history failure must be counted and logged, never allowed to roll back or
    // abort the rest of the batch.
    claimAutoResolvableAlerts.mockResolvedValue([alertRow('a'), alertRow('b')]);
    appendHistory
      .mockRejectedValueOnce(new Error('history insert failed'))
      .mockResolvedValueOnce(undefined);

    const sweep = new AlertAutoResolveSweep({} as Pool, logger(), runtime);
    const result = await sweep.run(200);

    expect(result.claimed).toBe(2);
    expect(result.resolved).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('never throws when the claim query fails, and reports the failure', async () => {
    claimAutoResolvableAlerts.mockRejectedValue(new Error('db down'));
    const sweep = new AlertAutoResolveSweep({} as Pool, logger(), runtime);

    const result = await sweep.run(200);

    // A failing sweep must not crash the worker - the next tick retries.
    expect(result.failed).toBe(1);
    expect(result.resolved).toBe(0);
  });

  it('does not overlap itself within a process', async () => {
    let release: (v: unknown) => void = () => {};
    claimAutoResolvableAlerts.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve([]);
    }));

    const sweep = new AlertAutoResolveSweep({} as Pool, logger(), runtime);
    const first = sweep.run(200);
    const second = await sweep.run(200); // must return immediately

    expect(second).toEqual({ claimed: 0, resolved: 0, failed: 0 });
    expect(claimAutoResolvableAlerts).toHaveBeenCalledTimes(1);

    release(null);
    await first;
  });
});

describe('claimAutoResolvableAlerts query contract', () => {
  it('only targets firing alerts whose deadline has passed, with SKIP LOCKED', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new AlertRuntimeRepository({ query } as unknown as Pool);

    await repo.claimAutoResolvableAlerts(50);

    const [sql, params] = query.mock.calls[0]!;
    // Eligibility predicates: must match the existing partial index so no new
    // index is required, and must exclude acknowledged (human-owned) alerts.
    expect(sql).toContain("state = 'firing'");
    expect(sql).toContain('auto_resolve_at IS NOT NULL');
    expect(sql).toContain('auto_resolve_at <= NOW()');
    // Concurrency safety across replicas.
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    // Idempotency: the same statement clears the predicates it selected on.
    expect(sql).toContain("resolution_reason = 'auto_resolved'");
    expect(sql).toContain('auto_resolve_at   = NULL');
    expect(params[0]).toBe(50);
  });

  it('clamps the batch size to a bounded range', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new AlertRuntimeRepository({ query } as unknown as Pool);

    await repo.claimAutoResolvableAlerts(100_000);
    expect(query.mock.calls[0]![1][0]).toBe(1000);

    await repo.claimAutoResolvableAlerts(0);
    expect(query.mock.calls[1]![1][0]).toBe(1);
  });

  it('supports optional tenant scoping', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new AlertRuntimeRepository({ query } as unknown as Pool);

    await repo.claimAutoResolvableAlerts(10, ORG);
    expect(query.mock.calls[0]![1][1]).toBe(ORG);

    await repo.claimAutoResolvableAlerts(10);
    expect(query.mock.calls[1]![1][1]).toBeNull();
  });
});
