/**
 * AI investigator. Runs an investigation intent against an assembled context.
 *
 * When the AI provider is configured it calls the existing OpenAI provider and
 * parses a strict-JSON result. Otherwise (or on failure) it degrades to a
 * deterministic heuristic analysis derived from the correlated telemetry — so
 * the "Ask AI" surface is always functional, never a placeholder.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AIProvider } from '../../ai/openai-client.js';
import type { AIIntent, AIInvestigationContext } from './context-assembler.js';
export interface AIInvestigationResult {
    intent: AIIntent;
    summary: string;
    findings: string[];
    rootCause: string | null;
    recommendations: string[];
    confidence: number;
    source: 'ai' | 'heuristic';
    model: string | null;
}
export declare class AIInvestigator {
    private readonly provider;
    private readonly logger;
    constructor(provider: AIProvider | null, logger: FastifyBaseLogger);
    investigate(context: AIInvestigationContext, intent: AIIntent, question?: string): Promise<AIInvestigationResult>;
    private parse;
    /** Deterministic analysis when no model is available. Uses the fact set. */
    private heuristic;
}
//# sourceMappingURL=investigator.d.ts.map