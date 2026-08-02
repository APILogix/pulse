/**
 * AI context assembler (Phase 15).
 *
 * The backend — never the frontend — assembles the context an investigation
 * runs on. Given a seed event and its correlated bundle, this produces a
 * sanitized, bounded fact set and the system/user prompts for each intent. No
 * frontend state is ever trusted; large/sensitive payloads are dropped or
 * truncated before they can reach a model.
 */
import type { TimelineBucket } from '../query-engine/index.js';
import type { CorrelationBundle, CorrelationKeys } from '../correlation/engine.js';
export declare const AI_INTENT_VALUES: readonly ["explain", "root_cause", "find_similar", "performance", "security", "optimization", "incident_summary", "ask"];
export type AIIntent = (typeof AI_INTENT_VALUES)[number];
export declare const AI_INTENTS: readonly AIIntent[];
export interface AIInvestigationContext {
    resource: string;
    seed: Record<string, unknown>;
    keys: CorrelationKeys;
    counts: Record<string, number>;
    facts: string[];
    timeline: TimelineBucket[];
}
/** Keep only allow-listed, bounded seed fields (drops bodies, headers, PII blobs). */
export declare function sanitizeSeed(seed: Record<string, unknown>): Record<string, unknown>;
/** Derive human-readable facts from the seed + correlated bundle. */
export declare function extractFacts(resource: string, seed: Record<string, unknown>, bundle: CorrelationBundle): string[];
export declare function assembleContext(resource: string, seed: Record<string, unknown>, bundle: CorrelationBundle, timeline: TimelineBucket[]): AIInvestigationContext;
export interface AssembledPrompts {
    system: string;
    user: string;
}
/** Build the model prompts for an intent. Output is always requested as JSON. */
export declare function buildPrompts(context: AIInvestigationContext, intent: AIIntent, question?: string): AssembledPrompts;
//# sourceMappingURL=context-assembler.d.ts.map