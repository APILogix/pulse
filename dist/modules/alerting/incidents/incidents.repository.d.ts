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
export type IncidentEventKind = 'incident_opened' | 'condition_still_breaching' | 'incident_acknowledged' | 'incident_assigned' | 'incident_resolved' | 'incident_reopened' | 'incident_escalated' | 'notification_created' | 'notification_suppressed';
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
export declare class IncidentsRepository {
    private readonly db;
    /** ADR-0006: pool injected explicitly; defaults to the primary/control pool. */
    constructor(db?: typeof pool);
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
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
    openOrReuse(input: OpenOrReuseIncidentInput, client?: PoolClient): Promise<OpenOrReuseIncidentResult>;
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
    resolveByFingerprint(organizationId: string, fingerprint: string, observedAt: Date, reason?: string, client?: PoolClient): Promise<AlertIncidentRow | null>;
    /** Tenant-scoped fetch. Returns null rather than throwing so callers map 404. */
    findById(organizationId: string, incidentId: string): Promise<AlertIncidentRow | null>;
    /**
     * Paginated, filtered, sorted incident list.
     *
     * All filtering, sorting and pagination happen in SQL. Nothing is filtered in
     * application memory, so response size is bounded by `limit` regardless of how
     * many incidents the tenant has.
     */
    list(organizationId: string, query: ListIncidentsQuery): Promise<{
        data: AlertIncidentRow[];
        total: number;
    }>;
    /**
     * Acknowledge an active incident.
     *
     * Guarded transition: only `open` may become `acknowledged`. Returns null when
     * the transition is not legal from the current state, which the service maps to
     * a 409 rather than silently succeeding.
     */
    acknowledge(organizationId: string, incidentId: string, actorUserId: string | null): Promise<AlertIncidentRow | null>;
    /** Manually resolve from the API. Legal from `open` or `acknowledged` only. */
    resolveById(organizationId: string, incidentId: string, actorUserId: string | null, reason: string): Promise<AlertIncidentRow | null>;
    /** Assign/unassign. Legal only while the incident is still active. */
    assign(organizationId: string, incidentId: string, assigneeUserId: string | null): Promise<AlertIncidentRow | null>;
    /**
     * Append a durable lifecycle event.
     *
     * Accepts an optional client so the caller can make the event atomic with the
     * incident transition that produced it. Both tables are in the primary
     * database, so unlike the cross-database enrichment path this genuinely can be
     * one transaction.
     */
    appendEvent(input: AppendIncidentEventInput, client?: PoolClient): Promise<void>;
    /** Durable per-incident timeline. Tenant-scoped via the incident join. */
    listEventsForIncident(organizationId: string, incidentId: string, limit: number, offset: number): Promise<{
        data: AlertIncidentEventRow[];
        total: number;
    }>;
    /**
     * Global cross-incident activity feed (Phase 22).
     *
     * Joins incident context (title/severity/rule) so the feed is renderable in one
     * request instead of N+1 lookups per row. Always paginated and tenant-scoped.
     */
    listActivity(organizationId: string, query: ListActivityQuery): Promise<{
        data: IncidentActivityRow[];
        total: number;
    }>;
    /**
     * Last-triggered timestamp per rule, for the Alert Rules page.
     * Batched by rule id so the page costs one query, not N.
     */
    lastTriggeredByRule(organizationId: string, ruleIds: string[]): Promise<Map<string, Date>>;
    /**
     * Overview counters. One grouped scan instead of six COUNT queries, so the
     * overview page costs a single round trip.
     */
    summary(organizationId: string, since: Date): Promise<{
        activeTotal: number;
        activeBySeverity: Record<string, number>;
        triggeredSince: number;
        resolvedSince: number;
    }>;
    /** Active incident counts per rule, for the Alert Rules page. Bounded by rule id list. */
    activeCountsByRule(organizationId: string, ruleIds: string[]): Promise<Map<string, number>>;
    static readonly ACTIVE_STATUSES: readonly ["open", "acknowledged"];
}
//# sourceMappingURL=incidents.repository.d.ts.map