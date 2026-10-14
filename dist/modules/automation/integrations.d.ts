import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { AutomationIntegrations, AiSummaryGenerator } from './types.js';
import type { AutomationRepository } from './repository.js';
import { AIAnalyzer } from '../ai/analyzer.js';
export declare class AutomationIntegrationError extends Error {
    constructor(message: string);
}
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
export declare function createAiSummaryGenerator(analyzer: Pick<AIAnalyzer, 'analyze'>, automationRepo: AutomationRepository): AiSummaryGenerator;
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
export declare function createAutomationIntegrations(deps: AutomationIntegrationDeps): AutomationIntegrations;
//# sourceMappingURL=integrations.d.ts.map