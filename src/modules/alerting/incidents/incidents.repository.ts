/**
 * Incident persistence (PRIMARY / control-plane database).
 *
 * ADR-0006: incidents are application state, so the primary database is
 * authoritative. The Log DB keeps telemetry and the high-volume alert event
 * facts; it is never the source of truth for incident lifecycle.
 *
 * Tenant isolation is enforced by always passing `organizationId` as the first
 * argument and including `organization_id = $1` in every WHERE clause. There is
 * no RLS backstop, so no method here may be called without a tenant.
 *
 * CONCURRENCY CONTRACT (the reason this file exists):
 *   - `openOrReuse()` must never create a second ACTIVE incident for one
 *     fingerprint, even with N workers evaluating the same rule simultaneously.
 *     It relies on the partial unique index `uq_alert_incident_active` and a
 *     single INSERT ... ON CONFLICT statement. Application-level
 *     "SELECT then INSERT" is race-prone and is deliberately NOT used.
 *   - `resolveByFingerprint()` must not let a STALE evaluation resolve an
 *     incident that has already seen newer activity.
 */
import type { PoolClient } from 'pg';
import { pool } from '../../../config/database.js';
import type { AlertSeverity } from '../types.js';

export type AlertIncidentStatus = 'open' | 'acknowledged' | 'resolved';

export interface AlertIncidentRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  environment: string | null;
  rule_id: string | null;
  rule_revision: number | null;
  binding_id: string | null;
  fingerprint: string;
  dimension_key: string;
  status: AlertIncidentStatus;
  severity: AlertSeverity;
  title: string;
  service: string | null;
  route: string | null;
  observed_value: string | null;
  threshold_value: string | null;
  occurrence_count: number;
  started_at: Date;
  last_seen_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  assigned_to: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_reason: string | null;
  labels: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/** Explicit column list - never `SELECT *`, so column drift is a compile-time concern. */
const INCIDENT_COLS = `
  id, organization_id, project_id, environment, rule_id, rule_revision, binding_id,
  fingerprint, dimension_key, status, severity, title, service, route,
  observed_value, threshold_value, occurrence_count, started_at, last_seen_at,
  acknowledged_at, acknowledged_by, assigned_to, resolved_at, resolved_by,
  resolution_reason, labels, created_at, updated_at
`;

const ACTIVE_STATUSES = ['open', 'acknowledged'] as const;

export interface OpenOrReuseIncidentInput {
  organizationId: string;
  projectId?: string | null;
  environment?: string | null;
  ruleId?: string | null;
  ruleRevision?: number | null;
  bindingId?: string | null;
  fingerprint: string;
  dimensionKey?: string;
  severity: AlertSeverity;
  title: string;
  service?: string | null;
  route?: string | null;
  observedValue?: number | null;
  thresholdValue?: number | null;
  observedAt: Date;
  labels?: Record<string, unknown>;
}

export interface OpenOrReuseIncidentResult {
  incident: AlertIncidentRow;
  /** True when this call inserted the row; false when an active one was reused. */
  created: boolean;
}

/** Durable incident lifecycle event kinds. Mirrors ck_alert_incident_event_kind. */
export type IncidentEventKind =
  | 'incident_opened'
  | 'condition_still_breaching'
  | 'incident_acknowledged'
  | 'incident_assigned'
  | 'incident_resolved'
  | 'incident_reopened'
  | 'incident_escalated'
  | 'notification_created'
  | 'notification_suppressed';

export interface AppendIncidentEventInput {
  incidentId: string;
  organizationId: string;
  projectId?: string | null;
  kind: IncidentEventKind;
  actorType?: 'worker' | 'user' | 'system' | 'api';
  actorUserId?: string | null;
  detail?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface AlertIncidentEventRow {
  id: string;
  incident_id: string;
  organization_id: string;
  project_id: string | null;
  kind: IncidentEventKind;
  actor_type: 'worker' | 'user' | 'system' | 'api';
  actor_user_id: string | null;
  detail: Record<string, unknown>;
  occurred_at: Date;
  created_at: Date;
}

/** Activity-feed row: lifecycle event joined with its incident context. */
export interface IncidentActivityRow extends Omit<AlertIncidentEventRow, 'created_at'> {
  incident_title: string;
  incident_severity: AlertSeverity;
  incident_status: AlertIncidentStatus;
  rule_id: string | null;
  service: string | null;
  environment: string | null;
}

export interface ListActivityQuery {
  limit: number;
  offset: number;
  kind?: IncidentEventKind | undefined;
  projectId?: string | undefined;
  incidentId?: string | undefined;
  severity?: AlertSeverity | undefined;
  ruleId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  search?: string | undefined;
}

export interface ListIncidentsQuery {
  limit: number;
  offset: number;
  sortBy?: string | undefined;
  sortOrder: 'asc' | 'desc';
  status?: AlertIncidentStatus | undefined;
  /** Convenience facet: any non-resolved status. */
  active?: boolean | undefined;
  severity?: AlertSeverity | undefined;
  projectId?: string | undefined;
  environment?: string | undefined;
  service?: string | undefined;
  route?: string | undefined;
  ruleId?: string | undefined;
  assignedTo?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  search?: string | undefined;
}

/**
 * Sortable columns, as an allow-list.
 *
 * Sort keys arrive from the client and are interpolated into ORDER BY, which
 * cannot be parameterised. Mapping through this record means an unknown value can
 * never reach the SQL string - it falls back to the default instead.
 */
const SORTABLE: Record<string, string> = {
  startedAt: 'started_at',
  lastSeenAt: 'last_seen_at',
  severity: 'severity',
  status: 'status',
  occurrenceCount: 'occurrence_count',
  updatedAt: 'updated_at',
};

export class IncidentsRepository {
  private readonly db: typeof pool;

  /** ADR-0006: pool injected explicitly; defaults to the primary/control pool. */
  constructor(db: typeof pool = pool) {
    this.db = db;
  }

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Open a new incident, or fold this match into the existing active one.
   *
   * Single atomic statement. `ON CONFLICT (organization_id, fingerprint) WHERE
   * status IN ('open','acknowledged')` targets the partial unique index, so when
   * two workers race, exactly one INSERT wins and the loser is converted into an
   * UPDATE of the same row. Neither caller has to check first, and there is no
   * window in which two active incidents can exist.
   *
   * `created` is derived from `xmax = 0`, the standard Postgres idiom for
   * "this row was inserted, not updated, by this statement".
   *
   * On reuse the update is deliberately conservative:
   *   - `last_seen_at` moves forward only (GREATEST), so an out-of-order/stale
   *     evaluation cannot rewind the recency of a live incident;
   *   - `severity` escalates only (never downgrades an active incident);
   *   - `started_at` is never touched.
   */
  async openOrReuse(
    input: OpenOrReuseIncidentInput,
    client?: PoolClient,
  ): Promise<OpenOrReuseIncidentResult> {
    const exec = client ?? this.db;
    const result = await exec.query<AlertIncidentRow & { was_inserted: boolean }>(
      `INSERT INTO alert_incidents (
         organization_id, project_id, environment, rule_id, rule_revision, binding_id,
         fingerprint, dimension_key, status, severity, title, service, route,
         observed_value, threshold_value, occurrence_count, started_at, last_seen_at, labels
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, 'open', $9::alert_severity, $10, $11, $12,
         $13, $14, 1, $15, $15, $16::jsonb
       )
       ON CONFLICT (organization_id, fingerprint) WHERE status IN ('open', 'acknowledged')
       DO UPDATE SET
         occurrence_count = alert_incidents.occurrence_count + 1,
         last_seen_at     = GREATEST(alert_incidents.last_seen_at, EXCLUDED.last_seen_at),
         observed_value   = EXCLUDED.observed_value,
         threshold_value  = EXCLUDED.threshold_value,
         severity         = GREATEST(alert_incidents.severity, EXCLUDED.severity),
         updated_at       = NOW()
       RETURNING ${INCIDENT_COLS}, (xmax = 0) AS was_inserted`,
      [
        input.organizationId,
        input.projectId ?? null,
        input.environment ?? null,
        input.ruleId ?? null,
        input.ruleRevision ?? null,
        input.bindingId ?? null,
        input.fingerprint,
        input.dimensionKey ?? 'global',
        input.severity,
        input.title.slice(0, 500),
        input.service ?? null,
        input.route ?? null,
        input.observedValue ?? null,
        input.thresholdValue ?? null,
        input.observedAt,
        JSON.stringify(input.labels ?? {}),
      ],
    );

    const row = result.rows[0];
    if (!row) {
      // Unreachable: ON CONFLICT DO UPDATE always returns a row.
      throw new Error('openOrReuse returned no row');
    }
    const { was_inserted: created, ...incident } = row;
    return { incident: incident as AlertIncidentRow, created };
  }

  /**
   * Resolve the active incident for a fingerprint, if any.
   *
   * STALENESS GUARD: `last_seen_at <= $3` means an evaluation may only resolve an
   * incident whose newest observation is not newer than the observation this
   * resolution is based on. A slow/replayed worker carrying an old timestamp
   * therefore cannot close an incident that has since re-breached. Returns null
   * when nothing was resolved (already resolved, or superseded) - callers must
   * treat null as "do not emit a recovery notification".
   */
  async resolveByFingerprint(
    organizationId: string,
    fingerprint: string,
    observedAt: Date,
    reason = 'condition_recovered',
    client?: PoolClient,
  ): Promise<AlertIncidentRow | null> {
    const exec = client ?? this.db;
    const result = await exec.query<AlertIncidentRow>(
      `UPDATE alert_incidents
          SET status            = 'resolved',
              resolved_at       = NOW(),
              resolution_reason = $4,
              updated_at        = NOW()
        WHERE organization_id = $1
          AND fingerprint     = $2
          AND status IN ('open', 'acknowledged')
          AND last_seen_at   <= $3
      RETURNING ${INCIDENT_COLS}`,
      [organizationId, fingerprint, observedAt, reason],
    );
    return result.rows[0] ?? null;
  }

  /** Tenant-scoped fetch. Returns null rather than throwing so callers map 404. */
  async findById(organizationId: string, incidentId: string): Promise<AlertIncidentRow | null> {
    const result = await this.db.query<AlertIncidentRow>(
      `SELECT ${INCIDENT_COLS} FROM alert_incidents WHERE id = $1 AND organization_id = $2`,
      [incidentId, organizationId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Paginated, filtered, sorted incident list.
   *
   * All filtering, sorting and pagination happen in SQL. Nothing is filtered in
   * application memory, so response size is bounded by `limit` regardless of how
   * many incidents the tenant has.
   */
  async list(
    organizationId: string,
    query: ListIncidentsQuery,
  ): Promise<{ data: AlertIncidentRow[]; total: number }> {
    const conditions = ['organization_id = $1'];
    const params: unknown[] = [organizationId];

    const add = (sql: string, value: unknown): void => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (query.status) add('status = ?::alert_incident_status', query.status);
    // `active` is a shorthand facet and is ignored when an explicit status is given.
    else if (query.active === true) conditions.push(`status IN ('open', 'acknowledged')`);
    else if (query.active === false) conditions.push(`status = 'resolved'`);

    if (query.severity) add('severity = ?::alert_severity', query.severity);
    if (query.projectId) add('project_id = ?', query.projectId);
    if (query.environment) add('environment = ?', query.environment);
    if (query.service) add('service = ?', query.service);
    if (query.route) add('route = ?', query.route);
    if (query.ruleId) add('rule_id = ?', query.ruleId);
    if (query.assignedTo) add('assigned_to = ?', query.assignedTo);
    if (query.from) add('started_at >= ?', query.from);
    if (query.to) add('started_at <= ?', query.to);
    // Wildcards are added on the JS side so the value stays a bind parameter and
    // is never interpolated into the SQL text. One param, referenced three times.
    if (query.search) {
      params.push(`%${query.search}%`);
      const p = `$${params.length}`;
      conditions.push(`(title ILIKE ${p} OR service ILIKE ${p} OR route ILIKE ${p})`);
    }

    const where = conditions.join(' AND ');
    const sortColumn = SORTABLE[query.sortBy ?? ''] ?? 'started_at';
    const sortDir = query.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM alert_incidents WHERE ${where}`,
      params,
    );

    params.push(query.limit, query.offset);
    const rows = await this.db.query<AlertIncidentRow>(
      `SELECT ${INCIDENT_COLS} FROM alert_incidents
        WHERE ${where}
        ORDER BY ${sortColumn} ${sortDir}, id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { data: rows.rows, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  /**
   * Acknowledge an active incident.
   *
   * Guarded transition: only `open` may become `acknowledged`. Returns null when
   * the transition is not legal from the current state, which the service maps to
   * a 409 rather than silently succeeding.
   */
  async acknowledge(
    organizationId: string,
    incidentId: string,
    actorUserId: string | null,
  ): Promise<AlertIncidentRow | null> {
    const result = await this.db.query<AlertIncidentRow>(
      `UPDATE alert_incidents
          SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $3, updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status = 'open'
      RETURNING ${INCIDENT_COLS}`,
      [incidentId, organizationId, actorUserId],
    );
    return result.rows[0] ?? null;
  }

  /** Manually resolve from the API. Legal from `open` or `acknowledged` only. */
  async resolveById(
    organizationId: string,
    incidentId: string,
    actorUserId: string | null,
    reason: string,
  ): Promise<AlertIncidentRow | null> {
    const result = await this.db.query<AlertIncidentRow>(
      `UPDATE alert_incidents
          SET status = 'resolved', resolved_at = NOW(), resolved_by = $3,
              resolution_reason = $4, updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status IN ('open', 'acknowledged')
      RETURNING ${INCIDENT_COLS}`,
      [incidentId, organizationId, actorUserId, reason],
    );
    return result.rows[0] ?? null;
  }

  /** Assign/unassign. Legal only while the incident is still active. */
  async assign(
    organizationId: string,
    incidentId: string,
    assigneeUserId: string | null,
  ): Promise<AlertIncidentRow | null> {
    const result = await this.db.query<AlertIncidentRow>(
      `UPDATE alert_incidents
          SET assigned_to = $3, updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 AND status IN ('open', 'acknowledged')
      RETURNING ${INCIDENT_COLS}`,
      [incidentId, organizationId, assigneeUserId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Append a durable lifecycle event.
   *
   * Accepts an optional client so the caller can make the event atomic with the
   * incident transition that produced it. Both tables are in the primary
   * database, so unlike the cross-database enrichment path this genuinely can be
   * one transaction.
   */
  async appendEvent(input: AppendIncidentEventInput, client?: PoolClient): Promise<void> {
    const exec = client ?? this.db;
    await exec.query(
      `INSERT INTO alert_incident_events (
         incident_id, organization_id, project_id, kind, actor_type, actor_user_id,
         detail, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        input.incidentId,
        input.organizationId,
        input.projectId ?? null,
        input.kind,
        input.actorType ?? 'worker',
        input.actorUserId ?? null,
        JSON.stringify(input.detail ?? {}),
        input.occurredAt ?? new Date(),
      ],
    );
  }

  /** Durable per-incident timeline. Tenant-scoped via the incident join. */
  async listEventsForIncident(
    organizationId: string,
    incidentId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: AlertIncidentEventRow[]; total: number }> {
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM alert_incident_events
        WHERE incident_id = $1 AND organization_id = $2`,
      [incidentId, organizationId],
    );
    const rows = await this.db.query<AlertIncidentEventRow>(
      `SELECT id, incident_id, organization_id, project_id, kind, actor_type,
              actor_user_id, detail, occurred_at, created_at
         FROM alert_incident_events
        WHERE incident_id = $1 AND organization_id = $2
        ORDER BY occurred_at DESC, id DESC
        LIMIT $3 OFFSET $4`,
      [incidentId, organizationId, limit, offset],
    );
    return { data: rows.rows, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  /**
   * Global cross-incident activity feed (Phase 22).
   *
   * Joins incident context (title/severity/rule) so the feed is renderable in one
   * request instead of N+1 lookups per row. Always paginated and tenant-scoped.
   */
  async listActivity(
    organizationId: string,
    query: ListActivityQuery,
  ): Promise<{ data: IncidentActivityRow[]; total: number }> {
    const conditions = ['e.organization_id = $1'];
    const params: unknown[] = [organizationId];

    const add = (sql: string, value: unknown): void => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (query.kind) add('e.kind = ?', query.kind);
    if (query.projectId) add('e.project_id = ?', query.projectId);
    if (query.incidentId) add('e.incident_id = ?', query.incidentId);
    if (query.severity) add('i.severity = ?::alert_severity', query.severity);
    if (query.ruleId) add('i.rule_id = ?', query.ruleId);
    if (query.from) add('e.occurred_at >= ?', query.from);
    if (query.to) add('e.occurred_at <= ?', query.to);
    if (query.search) {
      params.push(`%${query.search}%`);
      conditions.push(`i.title ILIKE $${params.length}`);
    }

    const where = conditions.join(' AND ');
    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM alert_incident_events e
         JOIN alert_incidents i ON i.id = e.incident_id
        WHERE ${where}`,
      params,
    );

    params.push(query.limit, query.offset);
    const rows = await this.db.query<IncidentActivityRow>(
      `SELECT e.id, e.incident_id, e.organization_id, e.project_id, e.kind,
              e.actor_type, e.actor_user_id, e.detail, e.occurred_at,
              i.title AS incident_title, i.severity AS incident_severity,
              i.status AS incident_status, i.rule_id, i.service, i.environment
         FROM alert_incident_events e
         JOIN alert_incidents i ON i.id = e.incident_id
        WHERE ${where}
        ORDER BY e.occurred_at DESC, e.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: rows.rows, total: Number(countResult.rows[0]?.count ?? 0) };
  }

  /**
   * Last-triggered timestamp per rule, for the Alert Rules page.
   * Batched by rule id so the page costs one query, not N.
   */
  async lastTriggeredByRule(
    organizationId: string,
    ruleIds: string[],
  ): Promise<Map<string, Date>> {
    if (ruleIds.length === 0) return new Map();
    const result = await this.db.query<{ rule_id: string; last_triggered: Date }>(
      `SELECT rule_id, MAX(started_at) AS last_triggered
         FROM alert_incidents
        WHERE organization_id = $1 AND rule_id = ANY($2::uuid[])
        GROUP BY rule_id`,
      [organizationId, ruleIds],
    );
    return new Map(result.rows.map((row) => [row.rule_id, row.last_triggered]));
  }

  /**
   * Overview counters. One grouped scan instead of six COUNT queries, so the
   * overview page costs a single round trip.
   */
  async summary(organizationId: string, since: Date): Promise<{
    activeTotal: number;
    activeBySeverity: Record<string, number>;
    triggeredSince: number;
    resolvedSince: number;
  }> {
    const result = await this.db.query<{
      active_total: string;
      severity: AlertSeverity | null;
      active_by_severity: string;
      triggered_since: string;
      resolved_since: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('open','acknowledged'))::text AS active_total,
         severity,
         COUNT(*) FILTER (WHERE status IN ('open','acknowledged'))::text AS active_by_severity,
         COUNT(*) FILTER (WHERE started_at >= $2)::text                  AS triggered_since,
         COUNT(*) FILTER (WHERE resolved_at >= $2)::text                  AS resolved_since
       FROM alert_incidents
       WHERE organization_id = $1
       GROUP BY severity`,
      [organizationId, since],
    );

    const activeBySeverity: Record<string, number> = {};
    let activeTotal = 0;
    let triggeredSince = 0;
    let resolvedSince = 0;
    for (const row of result.rows) {
      const active = Number(row.active_by_severity);
      if (row.severity) activeBySeverity[row.severity] = active;
      activeTotal += active;
      triggeredSince += Number(row.triggered_since);
      resolvedSince += Number(row.resolved_since);
    }
    return { activeTotal, activeBySeverity, triggeredSince, resolvedSince };
  }

  /** Active incident counts per rule, for the Alert Rules page. Bounded by rule id list. */
  async activeCountsByRule(
    organizationId: string,
    ruleIds: string[],
  ): Promise<Map<string, number>> {
    if (ruleIds.length === 0) return new Map();
    const result = await this.db.query<{ rule_id: string; count: string }>(
      `SELECT rule_id, COUNT(*)::text AS count
         FROM alert_incidents
        WHERE organization_id = $1
          AND rule_id = ANY($2::uuid[])
          AND status IN ('open','acknowledged')
        GROUP BY rule_id`,
      [organizationId, ruleIds],
    );
    return new Map(result.rows.map((row) => [row.rule_id, Number(row.count)]));
  }

  static readonly ACTIVE_STATUSES = ACTIVE_STATUSES;
}
