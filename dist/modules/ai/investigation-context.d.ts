/**
 * Canonical Observability AI Investigation Context Resolver.
 *
 * Given a canonical reference (resource type + public ID), this module resolves
 * the underlying seed entity from LogDB, validates multi-tenant and project
 * authorization boundaries, correlates all related observability context
 * (errors, traces, requests, logs, spans, error groups, releases), and normalizes
 * the fact set into a structured AIRequestInput for AIAnalyzer.
 *
 * The frontend sends ONLY the reference; the backend resolves all context.
 */
import type { QueryContext } from '../observability/query-engine/index.js';
import type { ObservabilityRepository } from '../observability/repository.js';
import type { ObservabilityContextResolver } from '../observability/context.js';
import type { CorrelationEngine } from '../observability/correlation/engine.js';
import type { AIRequestInput, InvestigationResource } from './types.js';
export interface InvestigationContextDependencies {
    resolver: ObservabilityContextResolver;
    repository: ObservabilityRepository;
    correlation: CorrelationEngine;
}
/**
 * Normalizes input public ID to match database conventions while tolerating
 * diverse casing and prefix styles (e.g. `ERR-000000001`, `err_01...`, `REQ-1`, `req_...`).
 */
export declare function normalizePublicId(rawId: string, resource: InvestigationResource): string;
/**
 * Resolves the complete, normalized AI context for an investigation request.
 */
export declare function resolveInvestigationContext(orgId: string, userId: string, resource: InvestigationResource, publicId: string, deps: InvestigationContextDependencies): Promise<{
    aiInput: AIRequestInput;
    ctx: QueryContext;
    seedRow: Record<string, unknown>;
}>;
//# sourceMappingURL=investigation-context.d.ts.map