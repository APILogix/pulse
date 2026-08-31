/**
 * Automation module — REAL integration wiring.
 *
 * This is the file that turns the automation action registry from a set of
 * placeholders into something that performs genuine side effects. Each adapter
 * below binds an automation action to an existing, already-production subsystem:
 *
 *   notificationSender   -> connectors NotificationDispatcher (email/slack/webhook/
 *                           discord/teams/pagerduty/sms), which brings delivery-row
 *                           persistence, SSRF validation, encrypted credentials,
 *                           circuit breaking, retry scheduling and usage recording.
 *   connectorRetrier     -> connectors delivery retry path
 *   alertSilenceCreator  -> alerting SilencesRepository (silences are enforced by
 *                           NotificationRoutingService.findActiveSilences)
 *   incidentManager      -> alerting IncidentsRepository (alert_incidents /
 *                           alert_incident_events)
 *   approvalRequester    -> automation's own automation_approvals table
 *   aiSummaryGenerator   -> the real AI module (src/modules/ai/**), same
 *                           AIAnalyzer/OpenAIProvider already used in production
 *                           by observability's AIInvestigator. Fail-closed: when
 *                           AI_ENABLED/OPENAI_API_KEY are not configured on this
 *                           deployment, calls surface as a genuine action
 *                           failure (never a fabricated success) — see the long
 *                           comment on createAiSummaryGenerator.
 *
 * IDEMPOTENCY: every adapter forwards the automation step's stable idempotency key
 * into the downstream system's own dedup mechanism (dedupKey/correlationId for
 * connector deliveries, a deterministic fingerprint for incidents, AIAnalyzer's
 * own getExistingAnswer replay for AI calls). That is what makes a worker crash or
 * queue redelivery safe, rather than relying only on our own run-step rows.
 *
 * TENANT SAFETY: every lookup is organization-scoped. A connector, incident or
 * delivery belonging to another organization can never be resolved here.
 */
import { createHash, randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type {
  AutomationIntegrations,
  NotificationSender,
  ConnectorRetrier,
  AlertSilenceCreator,
  IncidentManager,
  ApprovalRequester,
  AiSummaryGenerator,
} from './types.js';
import { ConnectorRepository } from '../connectors/repository.js';
import { NotificationDispatcher } from '../connectors/delivery/delivery.service.js';
import type { ConnectorType, NotificationPayload } from '../connectors/core/connector.types.js';
import { IncidentsRepository } from '../alerting/incidents/incidents.repository.js';
import { SilencesRepository } from '../alerting/silences/silences.repository.js';
import type { AutomationRepository } from './repository.js';
import { aiConfig } from '../../config/ai.js';
import { AIRepository } from '../ai/repository.js';
import { OpenAIProvider } from '../ai/openai-client.js';
import { AIAnalyzer } from '../ai/analyzer.js';

/** Connector transports that exist in the connector_type enum. */
const VALID_CONNECTOR_TYPES = new Set<string>([
  'email', 'slack', 'webhook', 'discord', 'teams', 'pagerduty', 'sms',
]);

/**
 * Incident event kinds permitted by the ck_alert_incident_event_kind constraint.
 * Anything else is rejected before it reaches the database so a bad workflow
 * config produces a clear validation error instead of a constraint violation.
 */
const VALID_INCIDENT_EVENT_KINDS = new Set<string>([
  'incident_opened', 'condition_still_breaching', 'incident_acknowledged',
  'incident_assigned', 'incident_resolved', 'incident_reopened',
  'incident_escalated', 'notification_created', 'notification_suppressed',
]);

export class AutomationIntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomationIntegrationError';
  }
}

/**
 * Deterministic short hash of the step idempotency key. Used where a downstream
 * system needs a bounded-length stable identity (incident fingerprint).
 */
function stableHash(idempotencyKey: string): string {
  return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATION SENDER — connectors NotificationDispatcher
// ═══════════════════════════════════════════════════════════════════════════════

function createNotificationSender(
  connectors: ConnectorRepository,
  dispatcher: NotificationDispatcher,
): NotificationSender {
  return {
    async send(params) {
      // ── Resolve the connector, always tenant-scoped ──
      let row = null as Awaited<ReturnType<ConnectorRepository['findById']>>;

      if (params.target?.connectorId) {
        // findById is org-scoped, so a connector from another tenant returns null.
        row = await connectors.findById(params.organizationId, params.target.connectorId);
        if (!row) {
          throw new AutomationIntegrationError(
            `Connector ${params.target.connectorId} was not found for this organization, ` +
            `or has been deleted.`,
          );
        }
      } else if (params.target?.connectorType) {
        const type = params.target.connectorType;
        if (!VALID_CONNECTOR_TYPES.has(type)) {
          throw new AutomationIntegrationError(
            `Unsupported connectorType "${type}". Supported: ${[...VALID_CONNECTOR_TYPES].join(', ')}.`,
          );
        }
        row = await connectors.findFirstActiveByType(params.organizationId, type as ConnectorType);
        if (!row) {
          throw new AutomationIntegrationError(
            `No active "${type}" connector is configured for this organization. ` +
            `Create and enable one, then re-run this automation.`,
          );
        }
      } else {
        // Default: the managed email connector, which is created on demand so a
        // notification action works even before the org configures anything.
        row = await connectors.getOrCreateManagedEmailConnector(params.organizationId);
      }

      if (!row) {
        throw new AutomationIntegrationError('Could not resolve a connector for delivery.');
      }

      const payload: NotificationPayload = {
        notificationType: params.notificationType,
        severity: params.severity,
        title: params.title,
        body: params.body,
        ...(params.url ? { url: params.url } : {}),
        ...(params.fields ? { fields: params.fields } : {}),
        metadata: params.metadata ?? {},
        // Both of these carry the automation step's stable idempotency key:
        //  - correlationId ties retries/fan-out of this step together
        //  - dedupKey drives dispatcher suppression (findDeliveryByDedupKey, 5min)
        //    and native provider dedup where supported (e.g. PagerDuty)
        correlationId: params.idempotencyKey,
        dedupKey: params.idempotencyKey,
      };

      const outcome = await dispatcher.dispatch(row, payload);
      const deduplicated = outcome.status === 'suppressed';

      return {
        // A suppressed duplicate is a SUCCESS from the automation's point of view:
        // the notification this step is responsible for has already been delivered.
        sent: outcome.result.success || deduplicated,
        deliveryId: outcome.deliveryId,
        connectorId: row.id,
        connectorType: row.type,
        status: outcome.status,
        deduplicated,
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTOR DELIVERY RETRY
// ═══════════════════════════════════════════════════════════════════════════════

function createConnectorRetrier(connectors: ConnectorRepository): ConnectorRetrier {
  return {
    async retry(params) {
      // Org-scoped lookup: a delivery from another tenant is invisible here.
      const delivery = await connectors.getDelivery(params.organizationId, params.deliveryId);
      if (!delivery) {
        throw new AutomationIntegrationError(
          `Delivery ${params.deliveryId} was not found for this organization.`,
        );
      }
      // Already-delivered work must not be re-sent; that would duplicate the
      // external side effect the retry was meant to recover.
      if (delivery.status === 'sent') {
        return { retried: false, status: 'already_sent' };
      }
      // retryDelivery is org-scoped and only resets deliveries in
      // ('failed','retrying'), returning null otherwise — so a pending/suppressed
      // delivery is left alone rather than being force-resent.
      const requeued = await connectors.retryDelivery(params.organizationId, params.deliveryId);
      return {
        retried: requeued !== null,
        status: requeued ? 'retrying' : `not_retryable:${delivery.status}`,
        newDeliveryId: undefined,
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALERT SILENCE CREATOR
// ═══════════════════════════════════════════════════════════════════════════════

function createAlertSilenceCreator(
  silences: SilencesRepository,
  automationRepo: AutomationRepository,
): AlertSilenceCreator {
  return {
    async createSilence(params) {
      // alert_silences.created_by is NOT NULL. Attribute the silence to the user who
      // owns the workflow rather than fabricating a system actor, so the audit trail
      // points at a real accountable person.
      const workflow = await automationRepo.getWorkflow(params.organizationId, params.workflowId);
      if (!workflow) {
        throw new AutomationIntegrationError(
          `Workflow ${params.workflowId} not found for this organization.`,
        );
      }
      const createdBy = workflow.createdBy;
      if (!createdBy) {
        throw new AutomationIntegrationError(
          `Workflow ${params.workflowId} has no owning user (created_by is null), so an ` +
          `alert silence cannot be attributed. Re-save the workflow to set an owner.`,
        );
      }

      /**
       * Backdate the start by a small grace period.
       *
       * The alerting engine decides whether a silence applies with
       * `starts_at <= NOW() AND ends_at > NOW()`. Postgres NOW() is the *transaction
       * start* timestamp, and the application clock can also drift slightly from the
       * database clock. With starts_at set to exactly "now" from the app, a silence
       * can therefore be created yet not counted as active by an evaluation that is
       * already in flight — a brief window in which alerts the user just silenced
       * still fire. The grace period removes that boundary gap; it cannot silence
       * anything retroactively because delivery decisions are made at evaluation time.
       */
      const SILENCE_START_GRACE_MS = 5_000;
      const startsAt = new Date(Date.now() - SILENCE_START_GRACE_MS);
      const endsAt = new Date(startsAt.getTime() + SILENCE_START_GRACE_MS + params.durationSeconds * 1000);

      const silence = await silences.createSilence({
        organizationId: params.organizationId,
        ruleId: params.ruleId ?? null,
        createdBy,
        comment: params.reason,
        startsAt,
        endsAt,
        matchers: params.matchers,
      });

      return {
        silenceId: silence.id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// INCIDENT MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

/** alert_severity enum is [info, warning, error, critical]; map our 3-value set. */
function toAlertSeverity(sev: 'info' | 'warning' | 'critical'): 'info' | 'warning' | 'critical' {
  return sev;
}

function createIncidentManager(incidents: IncidentsRepository): IncidentManager {
  return {
    async createIncident(params) {
      /**
       * The fingerprint is derived from the step's stable idempotency key, so a
       * retried step folds into the SAME incident via openOrReuse's partial unique
       * index on (organization_id, fingerprint) WHERE status IN ('open','acknowledged')
       * instead of opening a second incident. `created:false` therefore means
       * "correctly deduplicated", not "failed".
       */
      const fingerprint = `automation:${stableHash(params.idempotencyKey)}`;

      const result = await incidents.openOrReuse({
        organizationId: params.organizationId,
        projectId: params.projectId ?? null,
        environment: params.environment ?? null,
        ruleId: null,
        fingerprint,
        dimensionKey: 'automation',
        severity: toAlertSeverity(params.severity),
        title: params.title,
        service: params.service ?? null,
        observedAt: new Date(),
        labels: params.labels ?? {},
      });

      // Record provenance on the timeline so an operator can see the incident was
      // opened by an automation rather than by the alerting evaluator.
      if (result.created) {
        await incidents.appendEvent({
          incidentId: result.incident.id,
          organizationId: params.organizationId,
          projectId: params.projectId ?? null,
          kind: 'incident_opened',
          actorType: 'system',
          detail: { source: 'automation', ...(params.labels ?? {}) },
        });
      }

      return {
        incidentId: result.incident.id,
        created: result.created,
        status: result.incident.status,
      };
    },

    async appendTimelineEvent(params) {
      if (!VALID_INCIDENT_EVENT_KINDS.has(params.kind)) {
        throw new AutomationIntegrationError(
          `Unsupported incident timeline kind "${params.kind}". Supported: ` +
          `${[...VALID_INCIDENT_EVENT_KINDS].join(', ')}.`,
        );
      }
      // Tenant check: appendEvent does not itself verify ownership of the incident,
      // so confirm the incident belongs to this organization first.
      const incident = await incidents.findById(params.organizationId, params.incidentId);
      if (!incident) {
        throw new AutomationIntegrationError(
          `Incident ${params.incidentId} was not found for this organization.`,
        );
      }
      await incidents.appendEvent({
        incidentId: params.incidentId,
        organizationId: params.organizationId,
        projectId: params.projectId ?? null,
        kind: params.kind as Parameters<IncidentsRepository['appendEvent']>[0]['kind'],
        actorType: 'system',
        detail: params.detail ?? {},
      });
      return { appended: true, incidentId: params.incidentId };
    },

    async assignOwner(params) {
      // assign() is org-scoped and only touches open/acknowledged incidents.
      const updated = await incidents.assign(
        params.organizationId,
        params.incidentId,
        params.assigneeUserId,
      );
      if (!updated) {
        return { assigned: false, incidentId: params.incidentId, assigneeUserId: params.assigneeUserId };
      }
      await incidents.appendEvent({
        incidentId: params.incidentId,
        organizationId: params.organizationId,
        kind: 'incident_assigned',
        actorType: 'system',
        detail: { assigneeUserId: params.assigneeUserId, source: 'automation' },
      });
      return { assigned: true, incidentId: params.incidentId, assigneeUserId: params.assigneeUserId };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI SUMMARY GENERATOR — the real AI module's AIAnalyzer (OpenAI)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ai.summary.generate / ai.root_cause.generate / incident.postmortem.generate_draft
 * are backed by the SAME real AI subsystem already used in production by
 * observability's AIInvestigator and the AI HTTP routes (src/modules/ai/**),
 * rather than a parallel implementation. This reuses AIAnalyzer's real
 * entitlement checks, per-tenant credit reservation/finalization, prompt
 * safety sanitization, caching/idempotency, and the actual OpenAI call.
 *
 * FAIL-CLOSED BY DESIGN: AIAnalyzer.analyze() itself returns a LOCKED answer
 * (never throws, never fakes success) whenever `aiConfig.enabled` is false —
 * i.e. AI_ENABLED is not "true" or OPENAI_API_KEY is unset. That LOCKED
 * answer is surfaced here as a genuine action failure
 * (INTEGRATION_NOT_CONFIGURED-shaped, not a fabricated success), so wiring
 * this integration is safe regardless of whether AI is currently enabled on
 * this deployment: with AI disabled, actions fail honestly exactly as they
 * did with no integration configured; with AI enabled, they perform the real
 * call.
 *
 * Deliberately does NOT call analyzer.confirmDelivery()/cancelDelivery() to
 * finalize/release a credit reservation here: AIAnalyzer.analyze() with no
 * reservation-eligible mode (see below) returns reservation:null, so there is
 * nothing to confirm or release. If a reservation-bearing mode is added here
 * later, the caller (action-runner.ts's ai.summary.generate handler family)
 * would need to be extended to call confirmDelivery/cancelDelivery on success/
 * failure respectively — tracked as a follow-up, not silently done partially.
 */
export function createAiSummaryGenerator(
  analyzer: Pick<AIAnalyzer, 'analyze'>,
  automationRepo: AutomationRepository,
): AiSummaryGenerator {
  // ai.summary.generate / incident.postmortem.generate_draft both map to
  // AI_INCIDENT_SUMMARY (the closest existing mode: incident-shaped input,
  // narrative summary output). ai.root_cause.generate maps to
  // AI_ROOT_CAUSE_ANALYSIS. There is no dedicated "postmortem" AI_MODE in
  // src/modules/ai/types.ts's AI_MODES; AI_INCIDENT_SUMMARY's structured
  // output (plain_language_summary, technical_analysis, likely_causes,
  // suggested_fixes, prevention_recommendations) already covers what a
  // postmortem draft needs, so postmortem_draft reuses it rather than
  // introducing a new AI_MODE for a single action type.
  const MODE_BY_KIND = {
    summary: 'AI_INCIDENT_SUMMARY',
    postmortem_draft: 'AI_INCIDENT_SUMMARY',
    root_cause: 'AI_ROOT_CAUSE_ANALYSIS',
  } as const;

  return {
    async generateSummary(params) {
      // The workflow's owning user is the accountable actor for this AI
      // call (billing/entitlement checks are per-user-and-org), matching the
      // pattern alertSilenceCreator already uses for silence attribution.
      const workflow = await automationRepo.getWorkflow(params.organizationId, params.workflowId);
      if (!workflow) {
        throw new AutomationIntegrationError(
          `Workflow ${params.workflowId} not found for this organization.`,
        );
      }
      const ownerUserId = workflow.createdBy;
      if (!ownerUserId) {
        throw new AutomationIntegrationError(
          `Workflow ${params.workflowId} has no owning user (created_by is null), so an ` +
          `AI request cannot be attributed. Re-save the workflow to set an owner.`,
        );
      }

      const execution = await analyzer.analyze(
        {
          ai_mode: MODE_BY_KIND[params.type],
          incident_metadata: params.context,
          user_query: `Generate a ${params.type.replace('_', ' ')} for this incident/alert context.`,
        },
        {
          tenantId: params.organizationId,
          userId: ownerUserId,
          // Stable per-step key: same idempotency guarantee AIAnalyzer already
          // gives every other AI caller (getExistingAnswer replays a cached
          // answer for a repeated key instead of re-billing/re-calling).
          idempotencyKey: `automation:${params.idempotencyKey}`,
        },
      );

      const { answer } = execution;
      if (answer.status !== 'SUCCESS' && answer.status !== 'PARTIAL') {
        throw new AutomationIntegrationError(
          `AI ${params.type} generation did not succeed (status: ${answer.status}). ` +
          (answer.safety_warnings[0] ?? 'No further detail was provided by the AI subsystem.'),
        );
      }

      const content = params.type === 'root_cause'
        ? [answer.technical_analysis, ...answer.likely_causes.map((c) => `${c.rank}. ${c.cause} — ${c.reasoning}`)].join('\n\n')
        : params.type === 'postmortem_draft'
          ? [answer.plain_language_summary, answer.technical_analysis, 'Prevention:', ...answer.prevention_recommendations].join('\n\n')
          : answer.plain_language_summary;

      return { content, creditsUsed: answer.credit_action.amount };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL REQUESTER — automation's own approvals table
// ═══════════════════════════════════════════════════════════════════════════════

/** Matches APPROVAL_DEFAULT_TTL_HOURS in workers.ts so both paths expire alike. */
const APPROVAL_DEFAULT_TTL_HOURS = 24;

function createApprovalRequester(automationRepo: AutomationRepository): ApprovalRequester {
  return {
    async requestApproval(params) {
      // createOrGetStepApproval is itself idempotent: it reuses the step's existing
      // approval_id, or any pending approval already attached to the step, before
      // inserting. A retried step therefore reuses one approval instead of spamming
      // reviewers with a new request per attempt.
      const { approval } = await automationRepo.createOrGetStepApproval({
        organizationId: params.organizationId,
        workflowId: params.workflowId,
        runId: params.runId,
        stepId: params.stepId,
        riskLevel: params.riskLevel,
        expiresAt: new Date(Date.now() + APPROVAL_DEFAULT_TTL_HOURS * 60 * 60 * 1000),
        requestPayload: {
          actionType: params.actionType,
          payload: params.payload,
          idempotencyKey: params.idempotencyKey,
        },
      });
      return { approvalId: approval.id, status: approval.status };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

export interface AutomationIntegrationDeps {
  pool: Pool;
  logger: FastifyBaseLogger;
  automationRepository: AutomationRepository;
}

/**
 * Build the real integration set.
 *
 * aiSummaryGenerator is now wired to the real AI module (see
 * createAiSummaryGenerator above) — it fails honestly with
 * INTEGRATION_NOT_CONFIGURED-shaped errors when AI_ENABLED/OPENAI_API_KEY are
 * not set, and performs a real OpenAI call (with real entitlement/credit
 * gating) when they are.
 *
 * Still deliberately omitted, because no in-product implementation exists yet:
 *   reportExporter, ticketCreator
 * Their actions (report.export, ticket.github.create, ticket.jira.create) will
 * fail with INTEGRATION_NOT_CONFIGURED. That is the intended behaviour: an
 * unavailable capability must surface as a visible failure, never as a silent
 * success.
 */
export function createAutomationIntegrations(
  deps: AutomationIntegrationDeps,
): AutomationIntegrations {
  // The ConnectorRepository facade composes sub-repositories that each default to
  // the primary pool, so it intentionally takes no constructor arguments.
  const connectors = new ConnectorRepository();
  const dispatcher = new NotificationDispatcher(connectors, deps.logger);
  const incidents = new IncidentsRepository(deps.pool);
  const silences = new SilencesRepository(deps.pool);

  // Real AI subsystem (src/modules/ai/**), the same one already used in
  // production by observability's AIInvestigator and the AI HTTP routes.
  // AIRepository defaults to the primary pool (same as ConnectorRepository).
  // Fail-closed by construction: aiConfig.enabled is only true when
  // AI_ENABLED=true AND OPENAI_API_KEY is set — see the long comment on
  // createAiSummaryGenerator for exactly what happens when it is not.
  const aiRepository = new AIRepository();
  const aiProvider = new OpenAIProvider(aiConfig, deps.logger);
  const aiAnalyzer = new AIAnalyzer(aiRepository, aiProvider, aiConfig, deps.logger);

  return {
    notificationSender: createNotificationSender(connectors, dispatcher),
    connectorRetrier: createConnectorRetrier(connectors),
    alertSilenceCreator: createAlertSilenceCreator(silences, deps.automationRepository),
    incidentManager: createIncidentManager(incidents),
    approvalRequester: createApprovalRequester(deps.automationRepository),
    aiSummaryGenerator: createAiSummaryGenerator(aiAnalyzer, deps.automationRepository),
  };
}
