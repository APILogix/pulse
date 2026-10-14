/**
 * Incident application service.
 *
 * Owns incident business rules: state-transition legality, DTO mapping, and the
 * composition of detail/timeline responses. Controllers stay thin; this layer
 * never touches SQL directly (that is the repository's job).
 *
 * Every public method takes `organizationId` first and passes it through to the
 * repository, so tenant scoping cannot be forgotten at a call site.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import {
  IncidentsRepository,
  type AlertIncidentRow,
  type AlertIncidentStatus,
  type IncidentEventKind,
  type ListIncidentsQuery,
} from './incidents.repository.js';
import type {
  IncidentDto,
  ListActivityQueryInput,
  ListIncidentsQueryInput,
} from './incidents.types.js';
import type { AlertSeverity } from '../types.js';
import { AlertConflictError, AlertNotFoundError, type RequestMeta } from '../types.js';
import {
  recordIncidentAcknowledged,
  recordIncidentResolved,
} from '../runtime/alert-runtime-metrics.js';

export interface IncidentsServiceDeps {
  repository: IncidentsRepository;
  logger: FastifyBaseLogger;
  /** Log DB pool, read-only, for timeline/notification enrichment. */
  logDb?: Pool | undefined;
}

/** A single incident timeline entry, reconstructed from existing audit sources. */
export interface IncidentTimelineEntry {
  at: string;
  kind: string;
  actorType: 'worker' | 'user' | 'system' | 'api';
  actorUserId: string | null;
  detail: Record<string, unknown>;
}

/** Activity-feed entry: a lifecycle event plus enough incident context to render. */
export interface IncidentActivityEntry {
  id: string;
  incidentId: string;
  projectId: string | null;
  kind: IncidentEventKind;
  actorType: 'worker' | 'user' | 'system' | 'api';
  actorUserId: string | null;
  detail: Record<string, unknown>;
  occurredAt: string;
  incidentTitle: string;
  incidentSeverity: AlertSeverity;
  incidentStatus: AlertIncidentStatus;
  ruleId: string | null;
  service: string | null;
  environment: string | null;
}

export interface IncidentNotificationEntry {
  id: string;
  channelKind: string;
  provider: string | null;
  status: string;
  attemptNumber: number | null;
  errorCategory: string | null;
  latencyMs: number | null;
  at: string;
}

export class IncidentsService {
  private readonly repo: IncidentsRepository;
  private readonly log: FastifyBaseLogger;
  private readonly logDb: Pool | undefined;

  constructor(deps: IncidentsServiceDeps) {
    this.repo = deps.repository;
    this.log = deps.logger;
    this.logDb = deps.logDb;
  }

  async listIncidents(
    organizationId: string,
    query: ListIncidentsQueryInput,
  ): Promise<{ data: IncidentDto[]; total: number }> {
    const repoQuery: ListIncidentsQuery = {
      limit: query.limit,
      offset: query.offset,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      status: query.status,
      active: query.active,
      severity: query.severity,
      projectId: query.projectId,
      environment: query.environment,
      service: query.service,
      route: query.route,
      ruleId: query.ruleId,
      assignedTo: query.assignedTo,
      from: query.from,
      to: query.to,
      search: query.search,
    };
    const { data, total } = await this.repo.list(organizationId, repoQuery);
    return { data: data.map(toIncidentDto), total };
  }

  async getIncident(organizationId: string, incidentId: string): Promise<IncidentDto> {
    const row = await this.repo.findById(organizationId, incidentId);
    if (!row) throw new AlertNotFoundError('Incident not found');
    return toIncidentDto(row);
  }

  /**
   * Acknowledge. Only `open -> acknowledged` is legal.
   *
   * The repository UPDATE carries `AND status = 'open'`, so an illegal transition
   * affects zero rows. We then distinguish "does not exist / wrong tenant" (404)
   * from "exists but not acknowledgeable" (409) with a follow-up tenant-scoped
   * read, rather than reporting a misleading success.
   */
  async acknowledgeIncident(
    organizationId: string,
    incidentId: string,
    meta: RequestMeta,
  ): Promise<IncidentDto> {
    const updated = await this.repo.acknowledge(organizationId, incidentId, meta.actorUserId);
    if (updated) {
      recordIncidentAcknowledged();
      await this.appendLifecycle(updated, 'incident_acknowledged', meta.actorUserId);
      this.log.info(
        { incidentId, organizationId, actorUserId: meta.actorUserId },
        'incident acknowledged',
      );
      return toIncidentDto(updated);
    }
    const existing = await this.repo.findById(organizationId, incidentId);
    if (!existing) throw new AlertNotFoundError('Incident not found');
    throw new AlertConflictError(
      `Incident cannot be acknowledged from status '${existing.status}'`,
    );
  }

  /** Manual resolve. Legal from `open` or `acknowledged`. */
  async resolveIncident(
    organizationId: string,
    incidentId: string,
    meta: RequestMeta,
    reason?: string,
  ): Promise<IncidentDto> {
    const updated = await this.repo.resolveById(
      organizationId,
      incidentId,
      meta.actorUserId,
      reason ?? 'manually_resolved',
    );
    if (updated) {
      recordIncidentResolved('manual');
      await this.appendLifecycle(updated, 'incident_resolved', meta.actorUserId, {
        reason: reason ?? 'manually_resolved',
      });
      this.log.info(
        { incidentId, organizationId, actorUserId: meta.actorUserId },
        'incident manually resolved',
      );
      return toIncidentDto(updated);
    }
    const existing = await this.repo.findById(organizationId, incidentId);
    if (!existing) throw new AlertNotFoundError('Incident not found');
    throw new AlertConflictError(`Incident is already '${existing.status}'`);
  }

  async assignIncident(
    organizationId: string,
    incidentId: string,
    assigneeUserId: string | null,
  ): Promise<IncidentDto> {
    const updated = await this.repo.assign(organizationId, incidentId, assigneeUserId);
    if (updated) {
      await this.appendLifecycle(updated, 'incident_assigned', assigneeUserId, {
        assigneeUserId,
      });
      return toIncidentDto(updated);
    }
    const existing = await this.repo.findById(organizationId, incidentId);
    if (!existing) throw new AlertNotFoundError('Incident not found');
    throw new AlertConflictError(`Resolved incidents cannot be reassigned`);
  }

  /**
   * Record a lifecycle transition on the durable timeline.
   *
   * Non-fatal by design: the incident state transition has already committed, so
   * failing to write its audit row must not turn a successful acknowledge/resolve
   * into an API error. The failure is logged rather than swallowed.
   */
  private async appendLifecycle(
    incident: AlertIncidentRow,
    kind: IncidentEventKind,
    actorUserId: string | null,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.repo.appendEvent({
        incidentId: incident.id,
        organizationId: incident.organization_id,
        projectId: incident.project_id,
        kind,
        actorType: actorUserId ? 'user' : 'system',
        actorUserId,
        detail,
      });
    } catch (err) {
      this.log.error(
        { err, incidentId: incident.id, kind },
        'incident lifecycle event append failed; transition already committed',
      );
    }
  }

  async getSummary(organizationId: string, sinceHours = 24): Promise<{
    activeTotal: number;
    activeBySeverity: Record<string, number>;
    triggeredSince: number;
    resolvedSince: number;
    windowHours: number;
  }> {
    const since = new Date(Date.now() - sinceHours * 3_600_000);
    const summary = await this.repo.summary(organizationId, since);
    return { ...summary, windowHours: sinceHours };
  }

  /**
   * Incident timeline, reconstructed from the EXISTING audit sources rather than a
   * new audit system: `alert_event_history_v2` (lifecycle) and
   * `alert_delivery_attempts_v2` (notification outcomes), both keyed by the same
   * canonical fingerprint that identifies the incident.
   *
   * Degrades gracefully: if the Log DB is unavailable we still return the
   * lifecycle milestones we can derive from the incident row itself, so the detail
   * page never hard-fails on an enrichment outage.
   */
  async getTimeline(
    organizationId: string,
    incidentId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: IncidentTimelineEntry[]; total: number }> {
    const incident = await this.repo.findById(organizationId, incidentId);
    if (!incident) throw new AlertNotFoundError('Incident not found');

    // Milestones derivable without the Log DB.
    const intrinsic: IncidentTimelineEntry[] = [
      {
        at: incident.started_at.toISOString(),
        kind: 'incident_opened',
        actorType: 'worker',
        actorUserId: null,
        detail: { severity: incident.severity, fingerprint: incident.fingerprint },
      },
    ];
    if (incident.occurrence_count > 1) {
      intrinsic.push({
        at: incident.last_seen_at.toISOString(),
        kind: 'condition_still_breaching',
        actorType: 'worker',
        actorUserId: null,
        detail: { occurrenceCount: incident.occurrence_count },
      });
    }
    if (incident.acknowledged_at) {
      intrinsic.push({
        at: incident.acknowledged_at.toISOString(),
        kind: 'incident_acknowledged',
        actorType: 'user',
        actorUserId: incident.acknowledged_by,
        detail: {},
      });
    }
    if (incident.resolved_at) {
      intrinsic.push({
        at: incident.resolved_at.toISOString(),
        kind: 'incident_resolved',
        actorType: incident.resolved_by ? 'user' : 'worker',
        actorUserId: incident.resolved_by,
        detail: { reason: incident.resolution_reason },
      });
    }

    // AUTHORITATIVE source: the durable primary-database lifecycle log. This
    // outlives Log DB telemetry retention, so a resolved incident's timeline is
    // still intact months later for postmortem/compliance review.
    const durable = await this.repo.listEventsForIncident(
      organizationId,
      incidentId,
      limit,
      offset,
    );

    if (durable.total > 0) {
      return {
        data: durable.data.map((row) => ({
          at: row.occurred_at.toISOString(),
          kind: row.kind,
          actorType: row.actor_type,
          actorUserId: row.actor_user_id,
          detail: row.detail ?? {},
        })),
        total: durable.total,
      };
    }

    // Fallback for incidents created before the durable log existed (or when the
    // lifecycle append failed): derive milestones from the incident row itself.
    // Intentionally NOT merged with the durable log - mixing the two would
    // double-report the same transitions.
    const merged = [...intrinsic].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return { data: merged.slice(offset, offset + limit), total: merged.length };
  }

  /**
   * Global cross-incident activity feed (Phase 22).
   *
   * Server-paginated and tenant-scoped. Incident context (title/severity/rule) is
   * joined in SQL so the feed renders without N+1 follow-up requests.
   */
  async getActivity(
    organizationId: string,
    query: ListActivityQueryInput,
  ): Promise<{ data: IncidentActivityEntry[]; total: number }> {
    const { data, total } = await this.repo.listActivity(organizationId, {
      limit: query.limit,
      offset: query.offset,
      kind: query.kind,
      projectId: query.projectId,
      incidentId: query.incidentId,
      severity: query.severity,
      ruleId: query.ruleId,
      from: query.from,
      to: query.to,
      search: query.search,
    });

    return {
      data: data.map((row) => ({
        id: row.id,
        incidentId: row.incident_id,
        projectId: row.project_id,
        kind: row.kind,
        actorType: row.actor_type,
        actorUserId: row.actor_user_id,
        detail: row.detail ?? {},
        occurredAt: row.occurred_at.toISOString(),
        incidentTitle: row.incident_title,
        incidentSeverity: row.incident_severity,
        incidentStatus: row.incident_status,
        ruleId: row.rule_id,
        service: row.service,
        environment: row.environment,
      })),
      total,
    };
  }

  /**
   * Per-rule incident enrichment for the Alert Rules page (Phase 21):
   * active incident count + last-triggered timestamp.
   *
   * Two batched queries for the whole page rather than two per rule.
   */
  async getRuleIncidentStats(
    organizationId: string,
    ruleIds: string[],
  ): Promise<Record<string, { activeIncidents: number; lastTriggeredAt: string | null }>> {
    const [counts, lastTriggered] = await Promise.all([
      this.repo.activeCountsByRule(organizationId, ruleIds),
      this.repo.lastTriggeredByRule(organizationId, ruleIds),
    ]);
    const out: Record<string, { activeIncidents: number; lastTriggeredAt: string | null }> = {};
    for (const ruleId of ruleIds) {
      out[ruleId] = {
        activeIncidents: counts.get(ruleId) ?? 0,
        lastTriggeredAt: lastTriggered.get(ruleId)?.toISOString() ?? null,
      };
    }
    return out;
  }

  /**
   * Notification attempts for an incident, from `alert_delivery_attempts_v2`
   * (Log DB), correlated by the incident's canonical fingerprint.
   *
   * Deliberately returns status/category/latency only - never provider
   * credentials, tokens, or raw provider response bodies.
   */
  async getNotifications(
    organizationId: string,
    incidentId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: IncidentNotificationEntry[]; total: number }> {
    const incident = await this.repo.findById(organizationId, incidentId);
    if (!incident) throw new AlertNotFoundError('Incident not found');
    if (!this.logDb) return { data: [], total: 0 };

    try {
      const result = await this.logDb.query<{
        id: string;
        channel_kind: string;
        status: string;
        attempt_number: number | null;
        error_category: string | null;
        latency_ms: number | null;
        created_at: Date;
        total: string;
      }>(
        `SELECT a.id, a.channel_kind, a.status, a.attempt_number,
                a.error_category, a.latency_ms, a.created_at,
                COUNT(*) OVER ()::text AS total
           FROM alert_delivery_attempts_v2 a
          WHERE a.organization_id = $1
            AND a.alert_event_id IN (
              SELECT id FROM alert_events_v2
               WHERE organization_id = $1 AND fingerprint = $2
            )
          ORDER BY a.created_at DESC
          LIMIT $3 OFFSET $4`,
        [organizationId, incident.fingerprint, limit, offset],
      );
      return {
        data: result.rows.map((row) => ({
          id: row.id,
          channelKind: row.channel_kind,
          provider: null,
          status: row.status,
          attemptNumber: row.attempt_number,
          errorCategory: row.error_category,
          latencyMs: row.latency_ms,
          at: row.created_at.toISOString(),
        })),
        total: Number(result.rows[0]?.total ?? 0),
      };
    } catch (err) {
      this.log.warn(
        { err, incidentId, organizationId },
        'incident notification enrichment unavailable',
      );
      return { data: [], total: 0 };
    }
  }
}

/** Row -> wire DTO. Numerics arrive as strings from pg and are normalized here. */
export function toIncidentDto(row: AlertIncidentRow): IncidentDto {
  const endedAt = row.resolved_at ?? new Date();
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    environment: row.environment,
    ruleId: row.rule_id,
    ruleRevision: row.rule_revision,
    fingerprint: row.fingerprint,
    dimensionKey: row.dimension_key,
    status: row.status,
    severity: row.severity,
    title: row.title,
    service: row.service,
    route: row.route,
    observedValue: row.observed_value === null ? null : Number(row.observed_value),
    thresholdValue: row.threshold_value === null ? null : Number(row.threshold_value),
    occurrenceCount: row.occurrence_count,
    startedAt: row.started_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    durationSeconds: Math.max(
      0,
      Math.round((endedAt.getTime() - row.started_at.getTime()) / 1000),
    ),
    acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
    acknowledgedBy: row.acknowledged_by,
    assignedTo: row.assigned_to,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolvedBy: row.resolved_by,
    resolutionReason: row.resolution_reason,
    labels: row.labels ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
