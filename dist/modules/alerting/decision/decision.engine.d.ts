import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import type { EffectiveAlertPolicy } from '../policy/types.js';
import { type AlertEventV2Row, type NotificationJobRow } from '../runtime/alert-runtime.repository.js';
import { NotificationRoutingService } from '../runtime/notification-routing.service.js';
import { type AlertLifecycleState } from './state-machine.js';
import { IncidentsRepository } from '../incidents/incidents.repository.js';
export interface AlertDecisionCandidate {
    organizationId: string;
    projectId?: string | null;
    environment?: string | null;
    service?: string | null;
    endpoint?: string | null;
    dimension?: string | null;
    ruleRevision: number;
    policy: EffectiveAlertPolicy;
    source: string;
    observedAt: Date;
    kind?: 'fired' | 'recovered';
    observedValue?: number | null;
    thresholdValue?: number | null;
    evidence?: Record<string, unknown>;
    labels?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    category?: string;
    conditionFieldPaths?: string[];
    /**
     * Canonical alert identity precomputed by the caller (runtime engines compute
     * this via `computeAlertFingerprint` for the cooldown gate). When present it is
     * used verbatim, guaranteeing the cooldown key and the durable dedup key are
     * the same value. Omit only for callers with no grouping context.
     */
    alertKey?: string;
}
export interface AlertDecisionResult {
    alertKey: string;
    duplicate: boolean;
    suppressed: boolean;
    state: AlertLifecycleState;
    event: AlertEventV2Row | null;
    notificationJobs: NotificationJobRow[];
}
/**
 * Derive the canonical alert identity for a decision candidate.
 *
 * This is a THIN ADAPTER over `alertIdentityHash` - the one canonical identity
 * function (see runtime/alert-fingerprint.ts). It exists only for callers that
 * do not already hold a computed fingerprint. Callers that DO have one (the
 * runtime engines, which computed it via `computeAlertFingerprint` for the
 * cooldown gate) must pass `candidate.alertKey` so that the cooldown key and the
 * durable dedup key are guaranteed to be byte-identical.
 *
 * The dimension key is normalized the same way here as in the grouping path:
 * when the engine supplies a pre-joined `dimension` we use it verbatim;
 * otherwise we build a sorted `k=v` key from service/endpoint so an ungrouped
 * alert still lands on a stable identity.
 */
export declare function alertFingerprint(candidate: Pick<AlertDecisionCandidate, 'organizationId' | 'projectId' | 'policy' | 'environment' | 'service' | 'endpoint' | 'dimension'>): string;
export declare class AlertDecisionEngine {
    private readonly runtime;
    private readonly log;
    private readonly routing;
    private readonly incidents;
    constructor(logDb: Pool, logger: FastifyBaseLogger, deps?: {
        routing?: NotificationRoutingService;
        /**
         * PRIMARY-db incident repository. Optional so existing tests and any
         * caller that only needs alert-event facts keep working; when omitted,
         * incident persistence is skipped and alert delivery is unaffected.
         */
        incidents?: IncidentsRepository;
    });
    /**
     * Persist the durable incident for a decision.
     *
     * INGESTION SAFETY: this runs inside `decide()`, which executes only in the
     * alert worker process (driven by the telemetry outbox relay / evaluation
     * crons). It is never on the ingestion request path, and it adds no per-event
     * work - one statement per *matched* evaluation, deduplicated onto an existing
     * active incident by the partial unique index.
     *
     * FAILURE POLICY: incident persistence is deliberately non-fatal. Notifying an
     * on-call engineer matters more than recording the incident row, so a primary-db
     * outage degrades bookkeeping rather than suppressing the page. The failure is
     * counted and logged, never swallowed silently.
     */
    private persistIncident;
    decide(candidate: AlertDecisionCandidate): Promise<AlertDecisionResult>;
}
//# sourceMappingURL=decision.engine.d.ts.map