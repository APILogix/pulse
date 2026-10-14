import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IncidentsRepository,
  type AlertIncidentRow,
} from '../../src/modules/alerting/incidents/incidents.repository.js';
import { IncidentsService, toIncidentDto } from '../../src/modules/alerting/incidents/incidents.service.js';
import { ListIncidentsQuerySchema } from '../../src/modules/alerting/incidents/incidents.types.js';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const INCIDENT = '44444444-4444-4444-8444-444444444444';
const USER = '55555555-5555-4555-8555-555555555555';

function logger(): FastifyBaseLogger {
  const log: any = {
    trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(),
    child: () => log,
  };
  return log as FastifyBaseLogger;
}

function row(overrides: Partial<AlertIncidentRow> = {}): AlertIncidentRow {
  return {
    id: INCIDENT,
    organization_id: ORG,
    project_id: PROJECT,
    environment: 'production',
    rule_id: null,
    rule_revision: 1,
    binding_id: null,
    fingerprint: 'fp-1',
    dimension_key: 'global',
    status: 'open',
    severity: 'critical',
    title: 'High latency',
    service: 'api',
    route: '/users/:id',
    observed_value: '900.5',
    threshold_value: '500',
    occurrence_count: 1,
    started_at: new Date('2026-01-01T00:00:00.000Z'),
    last_seen_at: new Date('2026-01-01T00:00:00.000Z'),
    acknowledged_at: null,
    acknowledged_by: null,
    assigned_to: null,
    resolved_at: null,
    resolved_by: null,
    resolution_reason: null,
    labels: {},
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * In-memory Postgres stand-in that reproduces the ACTIVE-UNIQUENESS semantics of
 * `uq_alert_incident_active`: at most one open/acknowledged row per
 * (organization_id, fingerprint), with unlimited resolved history.
 *
 * Statements are serialized through a promise chain, which is how Postgres
 * behaves for concurrent writers contending on the same unique index. A
 * check-then-insert implementation would interleave here and produce two active
 * rows; a single INSERT ... ON CONFLICT cannot.
 */
function activeUniquenessDb() {
  const rows: AlertIncidentRow[] = [];
  let tail: Promise<unknown> = Promise.resolve();
  let seq = 0;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const run = async () => {
      // Yield so any non-atomic implementation would interleave here.
      await new Promise((resolve) => setImmediate(resolve));

      if (sql.includes('INSERT INTO alert_incidents')) {
        const [orgId, projectId, environment, ruleId, ruleRevision, bindingId,
          fingerprint, dimensionKey, severity, title, service, route,
          observed, threshold, observedAt] = params as any[];

        const active = rows.find(
          (r) => r.organization_id === orgId && r.fingerprint === fingerprint
            && (r.status === 'open' || r.status === 'acknowledged'),
        );
        if (active) {
          // ON CONFLICT DO UPDATE branch.
          active.occurrence_count += 1;
          active.last_seen_at = new Date(Math.max(
            active.last_seen_at.getTime(),
            new Date(observedAt).getTime(),
          ));
          active.observed_value = observed === null ? null : String(observed);
          return { rows: [{ ...active, was_inserted: false }] };
        }
        const created = row({
          id: `incident-${++seq}`,
          organization_id: orgId,
          project_id: projectId,
          environment,
          rule_id: ruleId,
          rule_revision: ruleRevision,
          binding_id: bindingId,
          fingerprint,
          dimension_key: dimensionKey,
          status: 'open',
          severity,
          title,
          service,
          route,
          observed_value: observed === null ? null : String(observed),
          threshold_value: threshold === null ? null : String(threshold),
          occurrence_count: 1,
          started_at: new Date(observedAt),
          last_seen_at: new Date(observedAt),
        });
        rows.push(created);
        return { rows: [{ ...created, was_inserted: true }] };
      }

      if (sql.includes("SET status            = 'resolved'")) {
        // resolveByFingerprint, incl. the staleness guard `last_seen_at <= $3`.
        const [orgId, fingerprint, observedAt, reason] = params as any[];
        const target = rows.find(
          (r) => r.organization_id === orgId && r.fingerprint === fingerprint
            && (r.status === 'open' || r.status === 'acknowledged')
            && r.last_seen_at.getTime() <= new Date(observedAt).getTime(),
        );
        if (!target) return { rows: [] };
        target.status = 'resolved';
        target.resolved_at = new Date();
        target.resolution_reason = reason;
        return { rows: [target] };
      }

      return { rows: [] };
    };
    const next = tail.then(run, run);
    tail = next.catch(() => undefined);
    return next;
  });

  return { pool: { query } as unknown as Pool, rows };
}

function openInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    projectId: PROJECT,
    environment: 'production',
    fingerprint: 'fp-1',
    severity: 'critical' as const,
    title: 'High latency',
    service: 'api',
    route: '/users/:id',
    observedValue: 900,
    thresholdValue: 500,
    observedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('incident active-uniqueness (Phase 6)', () => {
  it('creates exactly ONE incident for 2 concurrent matches of the same fingerprint', async () => {
    const db = activeUniquenessDb();
    const repo = new IncidentsRepository(db.pool);

    const results = await Promise.all([
      repo.openOrReuse(openInput()),
      repo.openOrReuse(openInput()),
    ]);

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(db.rows.filter((r) => r.status === 'open')).toHaveLength(1);
    // The second match folded into the first rather than inserting.
    expect(db.rows[0]!.occurrence_count).toBe(2);
  });

  it('creates exactly ONE incident for 10 concurrent matches of the same fingerprint', async () => {
    const db = activeUniquenessDb();
    const repo = new IncidentsRepository(db.pool);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => repo.openOrReuse(openInput())),
    );

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]!.occurrence_count).toBe(10);
    // Every caller gets the same incident identity back.
    expect(new Set(results.map((r) => r.incident.id)).size).toBe(1);
  });

  it('does NOT create a new incident on repeated sequential matches', async () => {
    const db = activeUniquenessDb();
    const repo = new IncidentsRepository(db.pool);

    for (const minute of ['00', '01', '02']) {
      await repo.openOrReuse(openInput({
        observedAt: new Date(`2026-01-01T00:${minute}:00.000Z`),
      }));
    }

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]!.occurrence_count).toBe(3);
  });

  it('keeps DIFFERENT grouped routes as INDEPENDENT incidents', async () => {
    // The user-facing requirement: with route grouping, /users and /products are
    // separate incidents. Different fingerprints => different rows.
    const db = activeUniquenessDb();
    const repo = new IncidentsRepository(db.pool);

    const users = await repo.openOrReuse(openInput({ fingerprint: 'fp-users', route: '/users' }));
    const products = await repo.openOrReuse(openInput({ fingerprint: 'fp-products', route: '/products' }));

    expect(users.created).toBe(true);
    expect(products.created).toBe(true);
    expect(users.incident.id).not.toBe(products.incident.id);
    expect(db.rows).toHaveLength(2);
  });

  it('allows a NEW incident after the previous one resolved (recurrence)', async () => {
    // This is what a full UNIQUE(org, fingerprint) would wrongly forbid.
    const db = activeUniquenessDb();
    const repo = new IncidentsRepository(db.pool);

    const first = await repo.openOrReuse(openInput());
    expect(first.created).toBe(true);

    const resolved = await repo.resolveByFingerprint(
      ORG, 'fp-1', new Date('2026-01-01T00:05:00.000Z'),
    );
    expect(resolved).not.toBeNull();

    const second = await repo.openOrReuse(openInput({
      observedAt: new Date('2026-01-01T01:00:00.000Z'),
    }));
    expect(second.created).toBe(true);
    expect(second.incident.id).not.toBe(first.incident.id);
    expect(db.rows).toHaveLength(2);
  });

  it('does not let a STALE evaluation resolve an incident that has newer activity', async () => {
    const db = activeUniquenessDb();
    const repo = new IncidentsRepository(db.pool);

    await repo.openOrReuse(openInput({ observedAt: new Date('2026-01-01T00:00:00.000Z') }));
    // Incident re-breaches at 00:10.
    await repo.openOrReuse(openInput({ observedAt: new Date('2026-01-01T00:10:00.000Z') }));

    // A slow worker carrying the OLD 00:05 observation tries to resolve.
    const stale = await repo.resolveByFingerprint(
      ORG, 'fp-1', new Date('2026-01-01T00:05:00.000Z'),
    );
    expect(stale).toBeNull();
    expect(db.rows[0]!.status).toBe('open');

    // A current worker with a fresh observation resolves correctly.
    const fresh = await repo.resolveByFingerprint(
      ORG, 'fp-1', new Date('2026-01-01T00:15:00.000Z'),
    );
    expect(fresh).not.toBeNull();
    expect(db.rows[0]!.status).toBe('resolved');
  });

  it('resolves nothing when there is no active incident', async () => {
    const db = activeUniquenessDb();
    const repo = new IncidentsRepository(db.pool);
    expect(await repo.resolveByFingerprint(ORG, 'never-existed', new Date())).toBeNull();
  });
});

describe('incident repository query contract', () => {
  it('scopes every read by organization_id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);

    await repo.findById(ORG, INCIDENT);
    expect(query.mock.calls[0]![0]).toContain('organization_id = $2');
    expect(query.mock.calls[0]![1]).toEqual([INCIDENT, ORG]);

    await repo.list(ORG, { limit: 25, offset: 0, sortOrder: 'desc' });
    expect(query.mock.calls[1]![0]).toContain('organization_id = $1');
    expect(query.mock.calls[1]![1]![0]).toBe(ORG);
  });

  it('targets the partial unique index so resolved history is preserved', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ...row(), was_inserted: true }] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);
    await repo.openOrReuse(openInput());

    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain("ON CONFLICT (organization_id, fingerprint) WHERE status IN ('open', 'acknowledged')");
    // Reuse must never rewind recency or downgrade severity.
    expect(sql).toContain('GREATEST(alert_incidents.last_seen_at, EXCLUDED.last_seen_at)');
    expect(sql).toContain('GREATEST(alert_incidents.severity, EXCLUDED.severity)');
    expect(sql).toContain('occurrence_count = alert_incidents.occurrence_count + 1');
  });

  it('only allows known sort columns into ORDER BY', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);

    // A hostile sort key must not reach the SQL string.
    await repo.list(ORG, {
      limit: 10, offset: 0, sortOrder: 'desc',
      sortBy: 'started_at; DROP TABLE alert_incidents;--',
    });
    const sql = query.mock.calls[1]![0] as string;
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toContain('ORDER BY started_at DESC');

    await repo.list(ORG, { limit: 10, offset: 0, sortOrder: 'asc', sortBy: 'lastSeenAt' });
    expect(query.mock.calls[3]![0] as string).toContain('ORDER BY last_seen_at ASC');
  });

  it('parameterizes the search filter instead of interpolating it', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);
    await repo.list(ORG, { limit: 10, offset: 0, sortOrder: 'desc', search: "'; DROP TABLE x;--" });

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toContain("%'; DROP TABLE x;--%");
  });

  it('applies filters in SQL, not in memory', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);
    await repo.list(ORG, {
      limit: 10, offset: 0, sortOrder: 'desc',
      status: 'open', severity: 'critical', projectId: PROJECT,
      environment: 'production', service: 'api', ruleId: INCIDENT,
    });

    const sql = query.mock.calls[0]![0] as string;
    for (const clause of ['status =', 'severity =', 'project_id =', 'environment =', 'service =', 'rule_id =']) {
      expect(sql).toContain(clause);
    }
    // LIMIT/OFFSET are always present, so a client cannot request everything.
    expect(query.mock.calls[1]![0] as string).toContain('LIMIT');
  });
});

describe('incident service state transitions', () => {
  let repo: any;
  let svc: IncidentsService;

  beforeEach(() => {
    repo = {
      findById: vi.fn(),
      acknowledge: vi.fn(),
      resolveById: vi.fn(),
      assign: vi.fn(),
      list: vi.fn(),
      summary: vi.fn(),
    };
    svc = new IncidentsService({ repository: repo as IncidentsRepository, logger: logger() });
  });

  const meta = { actorUserId: USER, actorIp: '127.0.0.1', actorUserAgent: null, requestId: 'req-1' };

  it('acknowledges an open incident', async () => {
    repo.acknowledge.mockResolvedValue(row({ status: 'acknowledged', acknowledged_at: new Date() }));
    const dto = await svc.acknowledgeIncident(ORG, INCIDENT, meta);
    expect(dto.status).toBe('acknowledged');
  });

  it('returns 404-class error for an incident in another tenant', async () => {
    // Cross-tenant probe: the UPDATE matched nothing AND the scoped read finds
    // nothing, so the caller cannot distinguish "exists elsewhere" from "absent".
    repo.acknowledge.mockResolvedValue(null);
    repo.findById.mockResolvedValue(null);
    await expect(svc.acknowledgeIncident(OTHER_ORG, INCIDENT, meta))
      .rejects.toMatchObject({ code: 'ALERT_NOT_FOUND' });
  });

  it('rejects acknowledging an already-resolved incident with a conflict', async () => {
    repo.acknowledge.mockResolvedValue(null);
    repo.findById.mockResolvedValue(row({ status: 'resolved', resolved_at: new Date() }));
    await expect(svc.acknowledgeIncident(ORG, INCIDENT, meta))
      .rejects.toMatchObject({ code: 'ALERT_CONFLICT' });
  });

  it('resolves an active incident and records the reason', async () => {
    repo.resolveById.mockResolvedValue(row({
      status: 'resolved', resolved_at: new Date(), resolution_reason: 'false_positive',
    }));
    const dto = await svc.resolveIncident(ORG, INCIDENT, meta, 'false_positive');
    expect(dto.status).toBe('resolved');
    expect(dto.resolutionReason).toBe('false_positive');
    expect(repo.resolveById).toHaveBeenCalledWith(ORG, INCIDENT, USER, 'false_positive');
  });

  it('rejects double-resolve with a conflict rather than reporting success', async () => {
    repo.resolveById.mockResolvedValue(null);
    repo.findById.mockResolvedValue(row({ status: 'resolved', resolved_at: new Date() }));
    await expect(svc.resolveIncident(ORG, INCIDENT, meta))
      .rejects.toMatchObject({ code: 'ALERT_CONFLICT' });
  });

  it('refuses to reassign a resolved incident', async () => {
    repo.assign.mockResolvedValue(null);
    repo.findById.mockResolvedValue(row({ status: 'resolved', resolved_at: new Date() }));
    await expect(svc.assignIncident(ORG, INCIDENT, USER))
      .rejects.toMatchObject({ code: 'ALERT_CONFLICT' });
  });

  it('passes the tenant through to the repository on list', async () => {
    repo.list.mockResolvedValue({ data: [row()], total: 1 });
    const query = ListIncidentsQuerySchema.parse({ status: 'open' });
    const result = await svc.listIncidents(ORG, query);
    expect(repo.list).toHaveBeenCalledWith(ORG, expect.objectContaining({ status: 'open' }));
    expect(result.total).toBe(1);
    expect(result.data[0]!.projectId).toBe(PROJECT);
  });
});

describe('incident DTO mapping', () => {
  it('exposes projectId and normalizes pg numerics to numbers', () => {
    const dto = toIncidentDto(row());
    expect(dto.projectId).toBe(PROJECT);
    expect(dto.observedValue).toBe(900.5);
    expect(dto.thresholdValue).toBe(500);
    expect(typeof dto.startedAt).toBe('string');
  });

  it('computes duration to resolution for a resolved incident', () => {
    const dto = toIncidentDto(row({
      status: 'resolved',
      started_at: new Date('2026-01-01T00:00:00.000Z'),
      resolved_at: new Date('2026-01-01T00:05:00.000Z'),
    }));
    expect(dto.durationSeconds).toBe(300);
  });

  it('computes a live duration for an active incident', () => {
    const dto = toIncidentDto(row({ started_at: new Date(Date.now() - 60_000) }));
    expect(dto.durationSeconds).toBeGreaterThanOrEqual(59);
  });

  it('does not leak internal-only fields', () => {
    const dto = toIncidentDto(row()) as Record<string, unknown>;
    // snake_case columns must not survive into the wire contract.
    expect(dto.organization_id).toBeUndefined();
    expect(dto.last_seen_at).toBeUndefined();
  });
});

describe('incident list query validation', () => {
  it('defaults to a bounded page size', () => {
    const q = ListIncidentsQuerySchema.parse({});
    expect(q.limit).toBe(50);
    expect(q.offset).toBe(0);
  });

  it('caps limit so a client cannot request the whole table', () => {
    expect(() => ListIncidentsQuerySchema.parse({ limit: 100000 })).toThrow();
  });

  it('rejects a non-uuid projectId filter', () => {
    expect(() => ListIncidentsQuerySchema.parse({ projectId: 'not-a-uuid' })).toThrow();
  });

  it('parses the active shorthand into a boolean', () => {
    expect(ListIncidentsQuerySchema.parse({ active: 'true' }).active).toBe(true);
    expect(ListIncidentsQuerySchema.parse({ active: 'false' }).active).toBe(false);
  });
});


describe('durable incident timeline + activity feed', () => {
  it('appends a lifecycle event scoped to tenant and project', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);

    await repo.appendEvent({
      incidentId: INCIDENT,
      organizationId: ORG,
      projectId: PROJECT,
      kind: 'incident_opened',
      detail: { tier: 'fast' },
    });

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('INSERT INTO alert_incident_events');
    expect(params[0]).toBe(INCIDENT);
    expect(params[1]).toBe(ORG);
    expect(params[2]).toBe(PROJECT);
    expect(params[3]).toBe('incident_opened');
    // Detail is serialized as a jsonb bind param, never interpolated.
    expect(params[6]).toBe(JSON.stringify({ tier: 'fast' }));
  });

  it('reads the per-incident timeline scoped by BOTH incident and organization', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);

    await repo.listEventsForIncident(ORG, INCIDENT, 50, 0);

    // Tenant scoping must be present even though incident_id is already unique -
    // otherwise a leaked incident id would expose another tenant's timeline.
    expect(query.mock.calls[1]![0]).toContain('incident_id = $1 AND organization_id = $2');
    expect(query.mock.calls[1]![0]).toContain('LIMIT $3 OFFSET $4');
  });

  it('scopes and paginates the global activity feed', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);

    await repo.listActivity(ORG, {
      limit: 25, offset: 0, kind: 'incident_resolved', severity: 'critical', projectId: PROJECT,
    });

    const sql = query.mock.calls[1]![0] as string;
    expect(sql).toContain('e.organization_id = $1');
    expect(sql).toContain('JOIN alert_incidents i ON i.id = e.incident_id');
    expect(sql).toContain('e.kind =');
    expect(sql).toContain('i.severity =');
    expect(sql).toContain('LIMIT');
    // Incident context is joined in SQL so the feed needs no N+1 follow-ups.
    expect(sql).toContain('i.title AS incident_title');
  });

  it('parameterizes the activity search filter', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: '0' }] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);
    await repo.listActivity(ORG, { limit: 10, offset: 0, search: "'; DROP TABLE y;--" });

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).not.toContain('DROP TABLE');
    expect(params).toContain("%'; DROP TABLE y;--%");
  });

  it('returns empty maps for rule stats when no rule ids are given', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);

    expect((await repo.activeCountsByRule(ORG, [])).size).toBe(0);
    expect((await repo.lastTriggeredByRule(ORG, [])).size).toBe(0);
    // No query should be issued for an empty id list.
    expect(query).not.toHaveBeenCalled();
  });

  it('batches rule stats into one query per metric', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new IncidentsRepository({ query } as unknown as Pool);
    const ruleIds = [INCIDENT, USER];

    await repo.activeCountsByRule(ORG, ruleIds);
    await repo.lastTriggeredByRule(ORG, ruleIds);

    // ANY($2::uuid[]) instead of N separate queries.
    expect(query).toHaveBeenCalledTimes(2);
    for (const call of query.mock.calls) {
      expect(call[0]).toContain('= ANY($2::uuid[])');
      expect(call[0]).toContain('organization_id = $1');
    }
  });
});

describe('timeline source precedence', () => {
  const meta = { actorUserId: USER, actorIp: '127.0.0.1', actorUserAgent: null, requestId: 'r' };

  it('prefers the durable primary-db timeline over derived milestones', async () => {
    const repo = {
      findById: vi.fn().mockResolvedValue(row({ occurrence_count: 3 })),
      listEventsForIncident: vi.fn().mockResolvedValue({
        data: [{
          id: 'e1', incident_id: INCIDENT, organization_id: ORG, project_id: PROJECT,
          kind: 'incident_opened', actor_type: 'worker', actor_user_id: null,
          detail: { tier: 'fast' },
          occurred_at: new Date('2026-01-01T00:00:00.000Z'),
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        }],
        total: 1,
      }),
    } as any;
    const svc = new IncidentsService({ repository: repo, logger: logger() });

    const result = await svc.getTimeline(ORG, INCIDENT, 50, 0);

    expect(result.total).toBe(1);
    expect(result.data[0]!.kind).toBe('incident_opened');
    expect(result.data[0]!.detail).toEqual({ tier: 'fast' });
  });

  it('falls back to derived milestones for pre-existing incidents with no durable log', async () => {
    const repo = {
      findById: vi.fn().mockResolvedValue(row({
        occurrence_count: 2,
        acknowledged_at: new Date('2026-01-01T00:02:00.000Z'),
        acknowledged_by: USER,
      })),
      listEventsForIncident: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    } as any;
    const svc = new IncidentsService({ repository: repo, logger: logger() });

    const result = await svc.getTimeline(ORG, INCIDENT, 50, 0);

    // Derived from the incident row itself, so the detail page is never blank.
    const kinds = result.data.map((entry) => entry.kind);
    expect(kinds).toContain('incident_opened');
    expect(kinds).toContain('incident_acknowledged');
    // Newest first.
    expect(Date.parse(result.data[0]!.at)).toBeGreaterThanOrEqual(
      Date.parse(result.data[result.data.length - 1]!.at),
    );
  });

  it('does not fail a transition when its audit append fails', async () => {
    // The state change has already committed; losing the audit row must not turn
    // a successful acknowledge into an API error.
    const repo = {
      acknowledge: vi.fn().mockResolvedValue(row({ status: 'acknowledged', acknowledged_at: new Date() })),
      appendEvent: vi.fn().mockRejectedValue(new Error('audit table unavailable')),
      findById: vi.fn(),
    } as any;
    const svc = new IncidentsService({ repository: repo, logger: logger() });

    const dto = await svc.acknowledgeIncident(ORG, INCIDENT, meta);
    expect(dto.status).toBe('acknowledged');
    expect(repo.appendEvent).toHaveBeenCalled();
  });
});
