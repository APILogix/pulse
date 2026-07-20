/**
 * Feature flags — types.
 *
 * Backed by the `feature_flags` table (migration
 * 17_enterprise_ingestion/003_feature_flags.up.sql). Three scopes, resolved
 * most-specific-wins: project > organization > platform.
 */

export type FeatureFlagScope = 'platform' | 'organization' | 'project';

/** Well-known platform flag keys (seeded by the migration). */
export const FEATURE_FLAGS = {
  AI_ALERT_ANALYSIS: 'ai_alert_analysis',
  EXPERIMENTAL_PIPELINES: 'experimental_pipelines',
  BETA_PROCESSORS: 'beta_processors',
} as const;

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
