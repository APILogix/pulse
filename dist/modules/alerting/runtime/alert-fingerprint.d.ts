import type { EvaluationScope } from '../policy/resolve-rule.js';
import type { RuntimePayload } from './engines.js';
export declare const ALLOWED_GROUP_DIMENSIONS: readonly ["route", "endpoint", "service", "environment", "status_code", "statusCode", "method", "severity", "host"];
export type AllowedGroupDimension = (typeof ALLOWED_GROUP_DIMENSIONS)[number];
export interface AlertFingerprintInput {
    organizationId: string;
    projectId?: string | null;
    environment?: string | null;
    ruleId: string;
    policyId?: string | null;
    groupBy?: string[] | null;
    groupingKeyTemplate?: string | null;
    groupingEnabled?: boolean;
    scope?: EvaluationScope | null;
    payload?: RuntimePayload | null;
    evidence?: Record<string, unknown> | null;
    labels?: Record<string, unknown> | null;
    dimension?: string | null;
    severity?: string | null;
}
export interface AlertFingerprintResult {
    fingerprint: string;
    dimensionKey: string;
    normalizedDimensions: Record<string, string>;
}
/**
 * Extracts and parses requested grouping dimensions from rule configuration.
 */
export declare function resolveGroupingDimensions(input: AlertFingerprintInput): string[];
/**
 * THE canonical alert identity hash. This is the single source of truth for
 * "what makes two alert occurrences the same alert".
 *
 * Every consumer of alert identity MUST derive its key from this function:
 *   - Redis cooldown key
 *   - alert_events_v2.fingerprint / dedup_key / correlation_key
 *   - alert_event_state.alert_key
 *
 * Previously two structurally different hashes existed (one here, one in
 * decision.engine.ts). They agreed only by convention, so a divergence in how a
 * route/dimension was normalized could make the cooldown gate and the durable
 * dedup key disagree about alert identity. Keep this the only hashing site.
 */
export declare function alertIdentityHash(parts: {
    organizationId: string;
    projectId?: string | null;
    environment?: string | null;
    ruleId: string;
    policyId?: string | null;
    /** Pre-normalized, sorted dimension key, or 'global' when ungrouped. */
    dimensionKey: string;
}): string;
/**
 * Computes a deterministic alert fingerprint with normalized grouping dimensions.
 */
export declare function computeAlertFingerprint(input: AlertFingerprintInput): AlertFingerprintResult;
//# sourceMappingURL=alert-fingerprint.d.ts.map