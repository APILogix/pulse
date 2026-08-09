/**
 * Feature flags — types.
 *
 * Backed by the `feature_flags` table (migration
 * 17_enterprise_ingestion/003_feature_flags.up.sql). Three scopes, resolved
 * most-specific-wins: project > organization > platform.
 */
/** Well-known platform flag keys (seeded by the migration). */
export const FEATURE_FLAGS = {
    AI_ALERT_ANALYSIS: 'ai_alert_analysis',
    EXPERIMENTAL_PIPELINES: 'experimental_pipelines',
    BETA_PROCESSORS: 'beta_processors',
    ALERTING_CANONICAL_RESOLUTION: 'alerting_canonical_resolution',
    ALERTING_V2_EVALUATION: 'alerting_v2_evaluation',
    ALERTING_V2_ROUTING: 'alerting_v2_routing',
    ALERTING_V2_DELIVERY_STATUS: 'alerting_v2_delivery_status',
    ALERTING_V2_ESCALATION: 'alerting_v2_escalation',
    ALERTING_SHADOW_COMPARE: 'alerting_shadow_compare',
    ALERTING_LEGACY_THRESHOLD_WORKER: 'alerting_legacy_threshold_worker',
    ALERTING_LEGACY_BATCH_PROCESSOR: 'alerting_legacy_batch_processor',
    ALERTING_LEGACY_ESCALATION: 'alerting_legacy_escalation',
};
//# sourceMappingURL=types.js.map