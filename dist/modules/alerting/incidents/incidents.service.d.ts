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
import { IncidentsRepository, type AlertIncidentRow, type AlertIncidentStatus, type IncidentEventKind } from './incidents.repository.js';
import type { IncidentDto, ListActivityQueryInput, ListIncidentsQueryInput } from './incidents.types.js';
import type { AlertSeverity } from '../types.js';
import { type RequestMeta } from '../types.js';
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
export declare class IncidentsService {
    private readonly repo;
    private readonly log;
    private readonly logDb;
    constructor(deps: IncidentsServiceDeps);
    listIncidents(organizationId: string, query: ListIncidentsQueryInput): Promise<{
        data: IncidentDto[];
        total: number;
    }>;
    getIncident(organizationId: string, incidentId: string): Promise<IncidentDto>;
    /**
     * Acknowledge. Only `open -> acknowledged` is legal.
     *
     * The repository UPDATE carries `AND status = 'open'`, so an illegal transition
     * affects zero rows. We then distinguish "does not exist / wrong tenant" (404)
     * from "exists but not acknowledgeable" (409) with a follow-up tenant-scoped
     * read, rather than reporting a misleading success.
     */
    acknowledgeIncident(organizationId: string, incidentId: string, meta: RequestMeta): Promise<IncidentDto>;
    /** Manual resolve. Legal from `open` or `acknowledged`. */
    resolveIncident(organizationId: string, incidentId: string, meta: RequestMeta, reason?: string): Promise<IncidentDto>;
    assignIncident(organizationId: string, incidentId: string, assigneeUserId: string | null): Promise<IncidentDto>;
    /**
     * Record a lifecycle transition on the durable timeline.
     *
     * Non-fatal by design: the incident state transition has already committed, so
     * failing to write its audit row must not turn a successful acknowledge/resolve
     * into an API error. The failure is logged rather than swallowed.
     */
    private appendLifecycle;
    getSummary(organizationId: string, sinceHours?: number): Promise<{
        activeTotal: number;
        activeBySeverity: Record<string, number>;
        triggeredSince: number;
        resolvedSince: number;
        windowHours: number;
    }>;
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
    getTimeline(organizationId: string, incidentId: string, limit: number, offset: number): Promise<{
        data: IncidentTimelineEntry[];
        total: number;
    }>;
    /**
     * Global cross-incident activity feed (Phase 22).
     *
     * Server-paginated and tenant-scoped. Incident context (title/severity/rule) is
     * joined in SQL so the feed renders without N+1 follow-up requests.
     */
    getActivity(organizationId: string, query: ListActivityQueryInput): Promise<{
        data: IncidentActivityEntry[];
        total: number;
    }>;
    /**
     * Per-rule incident enrichment for the Alert Rules page (Phase 21):
     * active incident count + last-triggered timestamp.
     *
     * Two batched queries for the whole page rather than two per rule.
     */
    getRuleIncidentStats(organizationId: string, ruleIds: string[]): Promise<Record<string, {
        activeIncidents: number;
        lastTriggeredAt: string | null;
    }>>;
    /**
     * Notification attempts for an incident, from `alert_delivery_attempts_v2`
     * (Log DB), correlated by the incident's canonical fingerprint.
     *
     * Deliberately returns status/category/latency only - never provider
     * credentials, tokens, or raw provider response bodies.
     */
    getNotifications(organizationId: string, incidentId: string, limit: number, offset: number): Promise<{
        data: IncidentNotificationEntry[];
        total: number;
    }>;
}
/** Row -> wire DTO. Numerics arrive as strings from pg and are normalized here. */
export declare function toIncidentDto(row: AlertIncidentRow): IncidentDto;
//# sourceMappingURL=incidents.service.d.ts.map