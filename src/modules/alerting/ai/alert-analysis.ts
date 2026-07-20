/**
 * FUTURE AI INTEGRATION POINT — alert analysis hook.
 *
 * Position in the pipeline: POST-GENERATION, PRE-DELIVERY. After an alert
 * event has been created (and batched) but before connector delivery, the
 * batch processor MAY ask an AI provider to enrich the outgoing notification
 * (summary, triage suggestion, priority score).
 *
 * Contract for any future provider:
 *   - Gated per-org by the feature flag `ai_alert_analysis`
 *     (FEATURE_FLAGS.AI_ALERT_ANALYSIS) — checked by the CALLER.
 *   - MUST be non-blocking: the caller enforces a hard timeout (≤ 2s) and any
 *     failure/timeout/slow response MUST result in delivery proceeding
 *     WITHOUT enrichment. A hook must never fail or delay delivery.
 *   - Returns `null` when there is nothing useful to add.
 *
 * This module intentionally ships ONLY the registry + a no-op default; no AI
 * implementation exists yet. Register a provider with setAlertAnalysisHook().
 */

export interface AlertAnalysisResult {
  /** Short human-readable summary of the alert. */
  summary?: string;
  /** Suggested triage / next steps. */
  triage?: string;
  /** Optional provider-assigned priority/confidence score. */
  score?: number;
  /** Provider identifier (for observability/debugging). */
  provider?: string;
}

export interface AlertAnalysisInput {
  alertEventId: string;
  organizationId: string;
  projectId: string | null;
  payload: unknown;
}

export interface AlertAnalysisHook {
  analyze(input: AlertAnalysisInput): Promise<AlertAnalysisResult | null>;
}

/** Default hook: no enrichment. */
export class NoopAlertAnalysisHook implements AlertAnalysisHook {
  async analyze(): Promise<AlertAnalysisResult | null> {
    return null;
  }
}

let currentHook: AlertAnalysisHook = new NoopAlertAnalysisHook();

/** The currently registered analysis hook (NoopAlertAnalysisHook by default). */
export function getAlertAnalysisHook(): AlertAnalysisHook {
  return currentHook;
}

/** Register the AI analysis provider. Pass null to reset to the no-op hook. */
export function setAlertAnalysisHook(hook: AlertAnalysisHook | null): void {
  currentHook = hook ?? new NoopAlertAnalysisHook();
}
