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
};
//# sourceMappingURL=types.js.map