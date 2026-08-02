import promClient from 'prom-client';
import { register } from '../../config/metrics.js';
function counter(name, help, labels) {
    const existing = register.getSingleMetric(name);
    return existing ?? new promClient.Counter({ name, help, labelNames: labels, registers: [register] });
}
function histogram(name, help, labels) {
    const existing = register.getSingleMetric(name);
    return existing ?? new promClient.Histogram({
        name, help, labelNames: labels,
        buckets: [0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 10, 20, 30, 60],
        registers: [register],
    });
}
const requests = counter('ai_requests_total', 'AI requests by mode and status', ['mode', 'status']);
const credits = counter('ai_credits_total', 'AI credits finalized by mode', ['mode']);
const tokens = counter('ai_tokens_total', 'AI provider tokens by mode and type', ['mode', 'type']);
const cacheHits = counter('ai_cache_hits_total', 'AI answer cache hits by mode', ['mode']);
const fallbacks = counter('ai_model_fallbacks_total', 'AI provider fallback count by mode', ['mode']);
const safetyBlocks = counter('ai_safety_blocks_total', 'AI safety blocks by mode', ['mode']);
const lowConfidence = counter('ai_low_confidence_total', 'AI responses below success threshold', ['mode']);
const providerErrors = counter('ai_provider_errors_total', 'AI provider or structured-output failures by mode', ['mode']);
const ragChunks = counter('ai_rag_chunks_total', 'RAG chunks accepted after access and relevance filtering', ['mode']);
const hallucinationReports = counter('ai_hallucination_reports_total', 'User corrections that may indicate unsupported AI claims', []);
const feedback = counter('ai_feedback_total', 'AI feedback submissions by helpfulness', ['helpful']);
const latency = histogram('ai_request_duration_seconds', 'End-to-end AI request latency', ['mode', 'status']);
const ragLatency = histogram('ai_rag_retrieval_duration_seconds', 'Tenant-scoped RAG retrieval latency', ['mode', 'status']);
const ragRelevance = new promClient.Histogram({
    name: 'ai_rag_relevance_score',
    help: 'Distribution of accepted RAG relevance scores',
    labelNames: ['mode'],
    buckets: [0.15, 0.25, 0.5, 0.75, 0.9, 1],
    registers: [register],
});
const feedbackScore = new promClient.Histogram({
    name: 'ai_feedback_score',
    help: 'Distribution of explicit AI feedback ratings',
    buckets: [1, 2, 3, 4, 5],
    registers: [register],
});
export class AICostTracker {
    recordCredits(mode, amount) {
        if (amount > 0)
            credits.inc({ mode }, amount);
    }
    recordRetrieval(mode, durationMs, scores, succeeded) {
        ragLatency.observe({ mode, status: succeeded ? 'success' : 'degraded' }, durationMs / 1_000);
        if (scores.length > 0) {
            ragChunks.inc({ mode }, scores.length);
            for (const score of scores)
                ragRelevance.observe({ mode }, score);
        }
    }
    recordFeedback(rating, helpful, correctionProvided = false) {
        feedback.inc({ helpful: helpful === undefined ? 'unspecified' : String(helpful) });
        if (rating !== undefined)
            feedbackScore.observe(rating);
        if (correctionProvided)
            hallucinationReports.inc();
    }
    record(input) {
        requests.inc({ mode: input.mode, status: input.status });
        latency.observe({ mode: input.mode, status: input.status }, input.durationMs / 1_000);
        if (input.credits > 0)
            credits.inc({ mode: input.mode }, input.credits);
        if (input.promptTokens)
            tokens.inc({ mode: input.mode, type: 'prompt' }, input.promptTokens);
        if (input.completionTokens)
            tokens.inc({ mode: input.mode, type: 'completion' }, input.completionTokens);
        if (input.cached)
            cacheHits.inc({ mode: input.mode });
        if (input.fallback)
            fallbacks.inc({ mode: input.mode });
        if (input.safetyBlocked)
            safetyBlocks.inc({ mode: input.mode });
        if (input.belowThreshold)
            lowConfidence.inc({ mode: input.mode });
        if (input.status === 'PROVIDER_ERROR')
            providerErrors.inc({ mode: input.mode });
    }
}
//# sourceMappingURL=cost-tracker.js.map