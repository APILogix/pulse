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
 * Computes a deterministic alert fingerprint with normalized grouping dimensions.
 */
export declare function computeAlertFingerprint(input: AlertFingerprintInput): AlertFingerprintResult;
//# sourceMappingURL=alert-fingerprint.d.ts.map