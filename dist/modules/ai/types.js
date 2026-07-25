/**
 * AI module — shared types and contracts.
 *
 * Defines the 11 AI modes, response statuses, default credit costs, minimum
 * confidence thresholds, the masterprompt INPUT CONTRACT (40 fields), and the
 * structured API output schemas from `masterprompt.md`. These contracts are
 * the source of truth for analyzer, routes, and billing integration code.
 */
import { z } from 'zod';
// ============================================
// AI MODES
// ============================================
export const AI_MODES = [
    'AI_ERROR_EXPLANATION',
    'AI_ROOT_CAUSE_ANALYSIS',
    'AI_STACK_TRACE_ANALYSIS',
    'AI_TRACE_ANALYSIS',
    'AI_SPAN_ANALYSIS',
    'AI_SUGGESTED_FIXES',
    'AI_SQL_OPTIMIZATION',
    'AI_LOG_SUMMARY',
    'AI_DEPLOYMENT_CORRELATION',
    'AI_INCIDENT_SUMMARY',
    'AI_WEEKLY_REPORT',
];
export const aiModeSchema = z.enum(AI_MODES);
// ============================================
// RESPONSE STATUS
// ============================================
export const AI_RESPONSE_STATUSES = [
    'SUCCESS',
    'PARTIAL',
    'FAILED',
    'LOCKED',
    'RATE_LIMITED',
    'SAFETY_BLOCKED',
    'INSUFFICIENT_CREDITS',
    'PROVIDER_ERROR',
    'INVALID_REQUEST',
];
export const aiResponseStatusSchema = z.enum(AI_RESPONSE_STATUSES);
// ============================================
// CREDIT COSTS (masterprompt safe defaults)
// ============================================
export const DEFAULT_CREDIT_COSTS = {
    AI_ERROR_EXPLANATION: 2,
    AI_ROOT_CAUSE_ANALYSIS: 3,
    AI_STACK_TRACE_ANALYSIS: 2,
    AI_TRACE_ANALYSIS: 3,
    AI_SPAN_ANALYSIS: 2,
    AI_SUGGESTED_FIXES: 3,
    AI_SQL_OPTIMIZATION: 3,
    AI_LOG_SUMMARY: 2,
    AI_DEPLOYMENT_CORRELATION: 3,
    AI_INCIDENT_SUMMARY: 5,
    AI_WEEKLY_REPORT: 5,
};
// ============================================
// MINIMUM CONFIDENCE THRESHOLDS (0-100)
// ============================================
export const MIN_CONFIDENCE = {
    AI_ERROR_EXPLANATION: 60,
    AI_ROOT_CAUSE_ANALYSIS: 65,
    AI_STACK_TRACE_ANALYSIS: 60,
    AI_TRACE_ANALYSIS: 65,
    AI_SPAN_ANALYSIS: 60,
    AI_SUGGESTED_FIXES: 65,
    AI_SQL_OPTIMIZATION: 65,
    AI_LOG_SUMMARY: 60,
    AI_DEPLOYMENT_CORRELATION: 65,
    AI_INCIDENT_SUMMARY: 60,
    AI_WEEKLY_REPORT: 60,
};
// ============================================
// INPUT CONTRACT (masterprompt, 40 fields)
// ============================================
/**
 * Generic JSON record for telemetry payloads (errors, logs, traces, spans,
 * metrics, deployments, RAG chunks, …). Shapes vary by observability backend,
 * so payloads stay loosely typed here and are sanitized before prompting.
 */
export const jsonRecordSchema = z.record(z.string().max(128), z.unknown());
const shortText = z.string().max(512);
const longText = z.string().max(100_000);
const telemetryArray = z.array(z.unknown()).max(1_000);
export const aiRequestInputSchema = z.object({
    // Request identity
    request_id: z.string().max(200).optional(),
    idempotency_key: z.string().max(200).optional(),
    tenant_id: z.string().max(200).optional(),
    user_id: z.string().max(200).optional(),
    user_role: shortText.optional(),
    user_plan: shortText.optional(),
    feature_entitlements: jsonRecordSchema.optional(),
    // Request intent — the only required field
    ai_mode: aiModeSchema,
    user_query: z.string().max(20_000).optional(),
    locale: shortText.optional(),
    timezone: shortText.optional(),
    // Scoping / context
    severity: shortText.optional(),
    service_name: shortText.optional(),
    environment_name: shortText.optional(),
    region: shortText.optional(),
    // Error telemetry
    error_payload: jsonRecordSchema.optional(),
    exception_type: shortText.optional(),
    exception_message: z.string().max(20_000).optional(),
    stack_trace: longText.optional(),
    // Observability payloads
    logs: telemetryArray.optional(),
    trace: jsonRecordSchema.optional(),
    spans: telemetryArray.optional(),
    metrics: telemetryArray.optional(),
    deployment_events: telemetryArray.optional(),
    incident_metadata: jsonRecordSchema.optional(),
    // SQL analysis payloads
    sql_query: longText.optional(),
    sql_explain_plan: longText.optional(),
    database_engine: shortText.optional(),
    schema_context: longText.optional(),
    // RAG / knowledge context
    rag_context: telemetryArray.optional(),
    prior_incidents: telemetryArray.optional(),
    runbooks: telemetryArray.optional(),
    code_references: telemetryArray.optional(),
    feature_flags: jsonRecordSchema.optional(),
    // Credit / caching context (raw rules as provided by the environment)
    credit_balance: z.number().optional(),
    credit_rules: jsonRecordSchema.optional(),
    cache_metadata: jsonRecordSchema.optional(),
    // Model behaviour overrides
    model_preferences: jsonRecordSchema.optional(),
    max_latency_ms: z.number().int().positive().optional(),
    response_format: z.string().optional(),
});
// ============================================
// STRUCTURED OUTPUT (masterprompt "OUTPUT STRUCTURE FOR API")
// ============================================
export const evidenceItemSchema = z.object({
    /** Evidence kind, e.g. "error_message", "log_line", "span", "deployment". */
    type: z.string(),
    /** Origin system or store, e.g. "loki", "tempo", "deployments". */
    source: z.string(),
    /** Stable identifier: trace ID, span ID, log line ref, deployment ID, … */
    identifier: z.string(),
    /** Short excerpt or summary (secrets/PII must be redacted). */
    excerpt_or_summary: z.string(),
    /** Relevance of this evidence to the claim, 0-1. */
    relevance: z.number().min(0).max(1),
    /** "confirmed" | "high" | "medium" | "low" (free-form allowed). */
    trust_level: z.string(),
}).strict();
export const likelyCauseSchema = z.object({
    /** 1 = most likely. */
    rank: z.number().int().min(1),
    cause: z.string(),
    /** Failure class: code, config, data, dependency, infrastructure, … */
    category: z.string(),
    /** 0-100 confidence for this specific cause. */
    confidence: z.number().min(0).max(100),
    evidence: z.array(evidenceItemSchema),
    reasoning: z.string(),
    recommended_action: z.string(),
}).strict();
export const citationSchema = z.object({
    /** "runbook" | "prior_incident" | "doc" | "log" | "trace" | … */
    source_type: z.string(),
    source_id: z.string(),
    title: z.string(),
    url_or_reference: z.string(),
    /** Access level required to view the source. */
    access_level: z.string(),
    /** Why this source materially influenced the answer. */
    why_cited: z.string(),
}).strict();
export const creditActionSchema = z.object({
    billable: z.boolean(),
    amount: z.number().min(0),
    reason: z.string(),
    mode: aiModeSchema,
    status: aiResponseStatusSchema,
    idempotency_key: z.string(),
    cached: z.boolean(),
    refunded: z.boolean(),
    /** Always true — only the backend credit service may actually deduct. */
    requires_backend_confirmation: z.literal(true),
}).strict();
export const aiAnswerSchema = z.object({
    status: aiResponseStatusSchema,
    ai_mode: aiModeSchema,
    request_id: z.string(),
    plain_language_summary: z.string(),
    business_impact: z.string(),
    technical_analysis: z.string(),
    likely_causes: z.array(likelyCauseSchema),
    evidence: z.array(evidenceItemSchema),
    confidence_score: z.number().min(0).max(100),
    suggested_fixes: z.array(z.string()),
    verification_steps: z.array(z.string()),
    prevention_recommendations: z.array(z.string()),
    missing_data: z.array(z.string()),
    citations: z.array(citationSchema),
    safety_warnings: z.array(z.string()),
    credit_action: creditActionSchema,
    /** Free-form extras: model route, latency, token usage, prompt version, … */
    metadata: z.record(z.string(), z.unknown()),
}).strict();
//# sourceMappingURL=types.js.map