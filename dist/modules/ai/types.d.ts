/**
 * AI module — shared types and contracts.
 *
 * Defines the 11 AI modes, response statuses, default credit costs, minimum
 * confidence thresholds, the masterprompt INPUT CONTRACT (40 fields), and the
 * structured API output schemas from `masterprompt.md`. These contracts are
 * the source of truth for analyzer, routes, and billing integration code.
 */
import { z } from 'zod';
export declare const AI_MODES: readonly ["AI_ERROR_EXPLANATION", "AI_ROOT_CAUSE_ANALYSIS", "AI_STACK_TRACE_ANALYSIS", "AI_TRACE_ANALYSIS", "AI_SPAN_ANALYSIS", "AI_SUGGESTED_FIXES", "AI_SQL_OPTIMIZATION", "AI_LOG_SUMMARY", "AI_DEPLOYMENT_CORRELATION", "AI_INCIDENT_SUMMARY", "AI_WEEKLY_REPORT"];
export type AIMode = (typeof AI_MODES)[number];
export declare const aiModeSchema: z.ZodEnum<{
    AI_ERROR_EXPLANATION: "AI_ERROR_EXPLANATION";
    AI_ROOT_CAUSE_ANALYSIS: "AI_ROOT_CAUSE_ANALYSIS";
    AI_STACK_TRACE_ANALYSIS: "AI_STACK_TRACE_ANALYSIS";
    AI_TRACE_ANALYSIS: "AI_TRACE_ANALYSIS";
    AI_SPAN_ANALYSIS: "AI_SPAN_ANALYSIS";
    AI_SUGGESTED_FIXES: "AI_SUGGESTED_FIXES";
    AI_SQL_OPTIMIZATION: "AI_SQL_OPTIMIZATION";
    AI_LOG_SUMMARY: "AI_LOG_SUMMARY";
    AI_DEPLOYMENT_CORRELATION: "AI_DEPLOYMENT_CORRELATION";
    AI_INCIDENT_SUMMARY: "AI_INCIDENT_SUMMARY";
    AI_WEEKLY_REPORT: "AI_WEEKLY_REPORT";
}>;
export declare const INVESTIGATION_RESOURCES: readonly ["error", "trace", "request", "logs", "log"];
export type InvestigationResource = (typeof INVESTIGATION_RESOURCES)[number];
export declare const investigationResourceSchema: z.ZodEnum<{
    error: "error";
    trace: "trace";
    request: "request";
    log: "log";
    logs: "logs";
}>;
export declare const aiInvestigationRequestSchema: z.ZodObject<{
    resource: z.ZodEnum<{
        error: "error";
        trace: "trace";
        request: "request";
        log: "log";
        logs: "logs";
    }>;
    publicId: z.ZodString;
}, z.core.$strip>;
export type AIInvestigationRequest = z.infer<typeof aiInvestigationRequestSchema>;
export declare const AI_RESPONSE_STATUSES: readonly ["SUCCESS", "PARTIAL", "FAILED", "LOCKED", "RATE_LIMITED", "SAFETY_BLOCKED", "INSUFFICIENT_CREDITS", "PROVIDER_ERROR", "INVALID_REQUEST"];
export type AIResponseStatus = (typeof AI_RESPONSE_STATUSES)[number];
export declare const aiResponseStatusSchema: z.ZodEnum<{
    RATE_LIMITED: "RATE_LIMITED";
    INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS";
    PROVIDER_ERROR: "PROVIDER_ERROR";
    FAILED: "FAILED";
    INVALID_REQUEST: "INVALID_REQUEST";
    SUCCESS: "SUCCESS";
    PARTIAL: "PARTIAL";
    LOCKED: "LOCKED";
    SAFETY_BLOCKED: "SAFETY_BLOCKED";
}>;
export declare const DEFAULT_CREDIT_COSTS: Record<AIMode, number>;
export declare const MIN_CONFIDENCE: Record<AIMode, number>;
/**
 * Credit rules resolved for a request. Environment-provided rules win over
 * `DEFAULT_CREDIT_COSTS`; the backend credit service is the final source of
 * truth — the model only recommends.
 */
export interface CreditRulesContext {
    costs: Record<AIMode, number>;
    /** Cost of a cached successful answer (masterprompt default: 0). */
    cachedCost: number;
    /** Cost of a partial answer when `chargePartial` is true. */
    partialCost: number;
    /** Whether partial answers are billable (masterprompt default: false). */
    chargePartial: boolean;
}
/**
 * Generic JSON record for telemetry payloads (errors, logs, traces, spans,
 * metrics, deployments, RAG chunks, …). Shapes vary by observability backend,
 * so payloads stay loosely typed here and are sanitized before prompting.
 */
export declare const jsonRecordSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
export declare const aiRequestInputSchema: z.ZodObject<{
    request_id: z.ZodOptional<z.ZodString>;
    idempotency_key: z.ZodOptional<z.ZodString>;
    tenant_id: z.ZodOptional<z.ZodString>;
    user_id: z.ZodOptional<z.ZodString>;
    user_role: z.ZodOptional<z.ZodString>;
    user_plan: z.ZodOptional<z.ZodString>;
    feature_entitlements: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    ai_mode: z.ZodEnum<{
        AI_ERROR_EXPLANATION: "AI_ERROR_EXPLANATION";
        AI_ROOT_CAUSE_ANALYSIS: "AI_ROOT_CAUSE_ANALYSIS";
        AI_STACK_TRACE_ANALYSIS: "AI_STACK_TRACE_ANALYSIS";
        AI_TRACE_ANALYSIS: "AI_TRACE_ANALYSIS";
        AI_SPAN_ANALYSIS: "AI_SPAN_ANALYSIS";
        AI_SUGGESTED_FIXES: "AI_SUGGESTED_FIXES";
        AI_SQL_OPTIMIZATION: "AI_SQL_OPTIMIZATION";
        AI_LOG_SUMMARY: "AI_LOG_SUMMARY";
        AI_DEPLOYMENT_CORRELATION: "AI_DEPLOYMENT_CORRELATION";
        AI_INCIDENT_SUMMARY: "AI_INCIDENT_SUMMARY";
        AI_WEEKLY_REPORT: "AI_WEEKLY_REPORT";
    }>;
    user_query: z.ZodOptional<z.ZodString>;
    locale: z.ZodOptional<z.ZodString>;
    timezone: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodString>;
    service_name: z.ZodOptional<z.ZodString>;
    environment_name: z.ZodOptional<z.ZodString>;
    region: z.ZodOptional<z.ZodString>;
    error_payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    exception_type: z.ZodOptional<z.ZodString>;
    exception_message: z.ZodOptional<z.ZodString>;
    stack_trace: z.ZodOptional<z.ZodString>;
    logs: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    trace: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    spans: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    metrics: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    deployment_events: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    incident_metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    sql_query: z.ZodOptional<z.ZodString>;
    sql_explain_plan: z.ZodOptional<z.ZodString>;
    database_engine: z.ZodOptional<z.ZodString>;
    schema_context: z.ZodOptional<z.ZodString>;
    rag_context: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    prior_incidents: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    runbooks: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    code_references: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
    feature_flags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    credit_balance: z.ZodOptional<z.ZodNumber>;
    credit_rules: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    cache_metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    model_preferences: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    max_latency_ms: z.ZodOptional<z.ZodNumber>;
    response_format: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AIRequestInput = z.infer<typeof aiRequestInputSchema>;
export declare const evidenceItemSchema: z.ZodObject<{
    type: z.ZodString;
    source: z.ZodString;
    identifier: z.ZodString;
    excerpt_or_summary: z.ZodString;
    relevance: z.ZodNumber;
    trust_level: z.ZodString;
}, z.core.$strict>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export declare const likelyCauseSchema: z.ZodObject<{
    rank: z.ZodNumber;
    cause: z.ZodString;
    category: z.ZodString;
    confidence: z.ZodNumber;
    evidence: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        source: z.ZodString;
        identifier: z.ZodString;
        excerpt_or_summary: z.ZodString;
        relevance: z.ZodNumber;
        trust_level: z.ZodString;
    }, z.core.$strict>>;
    reasoning: z.ZodString;
    recommended_action: z.ZodString;
}, z.core.$strict>;
export type LikelyCause = z.infer<typeof likelyCauseSchema>;
export declare const citationSchema: z.ZodObject<{
    source_type: z.ZodString;
    source_id: z.ZodString;
    title: z.ZodString;
    url_or_reference: z.ZodString;
    access_level: z.ZodString;
    why_cited: z.ZodString;
}, z.core.$strict>;
export type Citation = z.infer<typeof citationSchema>;
export declare const creditActionSchema: z.ZodObject<{
    billable: z.ZodBoolean;
    amount: z.ZodNumber;
    reason: z.ZodString;
    mode: z.ZodEnum<{
        AI_ERROR_EXPLANATION: "AI_ERROR_EXPLANATION";
        AI_ROOT_CAUSE_ANALYSIS: "AI_ROOT_CAUSE_ANALYSIS";
        AI_STACK_TRACE_ANALYSIS: "AI_STACK_TRACE_ANALYSIS";
        AI_TRACE_ANALYSIS: "AI_TRACE_ANALYSIS";
        AI_SPAN_ANALYSIS: "AI_SPAN_ANALYSIS";
        AI_SUGGESTED_FIXES: "AI_SUGGESTED_FIXES";
        AI_SQL_OPTIMIZATION: "AI_SQL_OPTIMIZATION";
        AI_LOG_SUMMARY: "AI_LOG_SUMMARY";
        AI_DEPLOYMENT_CORRELATION: "AI_DEPLOYMENT_CORRELATION";
        AI_INCIDENT_SUMMARY: "AI_INCIDENT_SUMMARY";
        AI_WEEKLY_REPORT: "AI_WEEKLY_REPORT";
    }>;
    status: z.ZodEnum<{
        RATE_LIMITED: "RATE_LIMITED";
        INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS";
        PROVIDER_ERROR: "PROVIDER_ERROR";
        FAILED: "FAILED";
        INVALID_REQUEST: "INVALID_REQUEST";
        SUCCESS: "SUCCESS";
        PARTIAL: "PARTIAL";
        LOCKED: "LOCKED";
        SAFETY_BLOCKED: "SAFETY_BLOCKED";
    }>;
    idempotency_key: z.ZodString;
    cached: z.ZodBoolean;
    refunded: z.ZodBoolean;
    requires_backend_confirmation: z.ZodLiteral<true>;
}, z.core.$strict>;
export type CreditAction = z.infer<typeof creditActionSchema>;
export declare const aiAnswerSchema: z.ZodObject<{
    status: z.ZodEnum<{
        RATE_LIMITED: "RATE_LIMITED";
        INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS";
        PROVIDER_ERROR: "PROVIDER_ERROR";
        FAILED: "FAILED";
        INVALID_REQUEST: "INVALID_REQUEST";
        SUCCESS: "SUCCESS";
        PARTIAL: "PARTIAL";
        LOCKED: "LOCKED";
        SAFETY_BLOCKED: "SAFETY_BLOCKED";
    }>;
    ai_mode: z.ZodEnum<{
        AI_ERROR_EXPLANATION: "AI_ERROR_EXPLANATION";
        AI_ROOT_CAUSE_ANALYSIS: "AI_ROOT_CAUSE_ANALYSIS";
        AI_STACK_TRACE_ANALYSIS: "AI_STACK_TRACE_ANALYSIS";
        AI_TRACE_ANALYSIS: "AI_TRACE_ANALYSIS";
        AI_SPAN_ANALYSIS: "AI_SPAN_ANALYSIS";
        AI_SUGGESTED_FIXES: "AI_SUGGESTED_FIXES";
        AI_SQL_OPTIMIZATION: "AI_SQL_OPTIMIZATION";
        AI_LOG_SUMMARY: "AI_LOG_SUMMARY";
        AI_DEPLOYMENT_CORRELATION: "AI_DEPLOYMENT_CORRELATION";
        AI_INCIDENT_SUMMARY: "AI_INCIDENT_SUMMARY";
        AI_WEEKLY_REPORT: "AI_WEEKLY_REPORT";
    }>;
    request_id: z.ZodString;
    plain_language_summary: z.ZodString;
    business_impact: z.ZodString;
    technical_analysis: z.ZodString;
    likely_causes: z.ZodArray<z.ZodObject<{
        rank: z.ZodNumber;
        cause: z.ZodString;
        category: z.ZodString;
        confidence: z.ZodNumber;
        evidence: z.ZodArray<z.ZodObject<{
            type: z.ZodString;
            source: z.ZodString;
            identifier: z.ZodString;
            excerpt_or_summary: z.ZodString;
            relevance: z.ZodNumber;
            trust_level: z.ZodString;
        }, z.core.$strict>>;
        reasoning: z.ZodString;
        recommended_action: z.ZodString;
    }, z.core.$strict>>;
    evidence: z.ZodArray<z.ZodObject<{
        type: z.ZodString;
        source: z.ZodString;
        identifier: z.ZodString;
        excerpt_or_summary: z.ZodString;
        relevance: z.ZodNumber;
        trust_level: z.ZodString;
    }, z.core.$strict>>;
    confidence_score: z.ZodNumber;
    suggested_fixes: z.ZodArray<z.ZodString>;
    verification_steps: z.ZodArray<z.ZodString>;
    prevention_recommendations: z.ZodArray<z.ZodString>;
    missing_data: z.ZodArray<z.ZodString>;
    citations: z.ZodArray<z.ZodObject<{
        source_type: z.ZodString;
        source_id: z.ZodString;
        title: z.ZodString;
        url_or_reference: z.ZodString;
        access_level: z.ZodString;
        why_cited: z.ZodString;
    }, z.core.$strict>>;
    safety_warnings: z.ZodArray<z.ZodString>;
    credit_action: z.ZodObject<{
        billable: z.ZodBoolean;
        amount: z.ZodNumber;
        reason: z.ZodString;
        mode: z.ZodEnum<{
            AI_ERROR_EXPLANATION: "AI_ERROR_EXPLANATION";
            AI_ROOT_CAUSE_ANALYSIS: "AI_ROOT_CAUSE_ANALYSIS";
            AI_STACK_TRACE_ANALYSIS: "AI_STACK_TRACE_ANALYSIS";
            AI_TRACE_ANALYSIS: "AI_TRACE_ANALYSIS";
            AI_SPAN_ANALYSIS: "AI_SPAN_ANALYSIS";
            AI_SUGGESTED_FIXES: "AI_SUGGESTED_FIXES";
            AI_SQL_OPTIMIZATION: "AI_SQL_OPTIMIZATION";
            AI_LOG_SUMMARY: "AI_LOG_SUMMARY";
            AI_DEPLOYMENT_CORRELATION: "AI_DEPLOYMENT_CORRELATION";
            AI_INCIDENT_SUMMARY: "AI_INCIDENT_SUMMARY";
            AI_WEEKLY_REPORT: "AI_WEEKLY_REPORT";
        }>;
        status: z.ZodEnum<{
            RATE_LIMITED: "RATE_LIMITED";
            INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS";
            PROVIDER_ERROR: "PROVIDER_ERROR";
            FAILED: "FAILED";
            INVALID_REQUEST: "INVALID_REQUEST";
            SUCCESS: "SUCCESS";
            PARTIAL: "PARTIAL";
            LOCKED: "LOCKED";
            SAFETY_BLOCKED: "SAFETY_BLOCKED";
        }>;
        idempotency_key: z.ZodString;
        cached: z.ZodBoolean;
        refunded: z.ZodBoolean;
        requires_backend_confirmation: z.ZodLiteral<true>;
    }, z.core.$strict>;
    metadata: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strict>;
export type AIAnswer = z.infer<typeof aiAnswerSchema>;
//# sourceMappingURL=types.d.ts.map