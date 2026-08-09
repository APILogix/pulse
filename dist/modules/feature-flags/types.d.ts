/**
 * Feature flags — types.
 *
 * Backed by the `feature_flags` table (migration
 * 17_enterprise_ingestion/003_feature_flags.up.sql). Three scopes, resolved
 * most-specific-wins: project > organization > platform.
 */
export type FeatureFlagScope = 'platform' | 'organization' | 'project';
/** Well-known platform flag keys (seeded by the migration). */
export declare const FEATURE_FLAGS: {
    readonly AI_ALERT_ANALYSIS: "ai_alert_analysis";
    readonly EXPERIMENTAL_PIPELINES: "experimental_pipelines";
    readonly BETA_PROCESSORS: "beta_processors";
    readonly ALERTING_CANONICAL_RESOLUTION: "alerting_canonical_resolution";
    readonly ALERTING_V2_EVALUATION: "alerting_v2_evaluation";
    readonly ALERTING_V2_ROUTING: "alerting_v2_routing";
    readonly ALERTING_V2_DELIVERY_STATUS: "alerting_v2_delivery_status";
    readonly ALERTING_V2_ESCALATION: "alerting_v2_escalation";
    readonly ALERTING_SHADOW_COMPARE: "alerting_shadow_compare";
    readonly ALERTING_LEGACY_THRESHOLD_WORKER: "alerting_legacy_threshold_worker";
    readonly ALERTING_LEGACY_BATCH_PROCESSOR: "alerting_legacy_batch_processor";
    readonly ALERTING_LEGACY_ESCALATION: "alerting_legacy_escalation";
};
export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS] | string;
export interface FeatureFlagContext {
    organizationId?: string | null;
    projectId?: string | null;
}
export interface FeatureFlagRow {
    id: string;
    key: string;
    scope: FeatureFlagScope;
    scope_id: string | null;
    enabled: boolean;
    payload: Record<string, unknown>;
    description: string | null;
    created_at: Date;
    updated_at: Date;
}
export interface SetFlagInput {
    key: string;
    scope: FeatureFlagScope;
    /** Required for organization/project scope, must be null for platform. */
    scopeId?: string | null;
    enabled: boolean;
    payload?: Record<string, unknown>;
    description?: string | null;
}
//# sourceMappingURL=types.d.ts.map