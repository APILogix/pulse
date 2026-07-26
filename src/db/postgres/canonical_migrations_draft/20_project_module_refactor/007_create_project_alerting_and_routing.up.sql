BEGIN;

CREATE TABLE IF NOT EXISTS project_alert_thresholds (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 environment_id UUID REFERENCES project_environments(id) ON DELETE CASCADE,
 threshold_key VARCHAR(100) NOT NULL, metric_name VARCHAR(100) NOT NULL, metric_source VARCHAR(100) NOT NULL,
 category VARCHAR(100) NOT NULL, severity VARCHAR(20) NOT NULL,
 comparison_operator VARCHAR(10) NOT NULL CHECK(comparison_operator IN ('>','>=','<','<=','=','!=')),
 threshold_value NUMERIC(20,5) NOT NULL, threshold_unit VARCHAR(50) NOT NULL,
 evaluation_window_minutes INTEGER NOT NULL DEFAULT 5 CHECK(evaluation_window_minutes>0),
 cooldown_minutes INTEGER NOT NULL DEFAULT 15 CHECK(cooldown_minutes>=0),
 consecutive_breaches INTEGER NOT NULL DEFAULT 1 CHECK(consecutive_breaches>0),
 enabled BOOLEAN NOT NULL DEFAULT true, notify_on_recovery BOOLEAN NOT NULL DEFAULT true,
 last_triggered_at TIMESTAMPTZ, last_recovered_at TIMESTAMPTZ,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_threshold_key ON project_alert_thresholds(project_id,environment_id,threshold_key) NULLS NOT DISTINCT WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_thresholds_evaluation ON project_alert_thresholds(organization_id,project_id,environment_id,enabled) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS project_alert_channels (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 connector_id UUID REFERENCES connector_configs(id) ON DELETE RESTRICT,
 channel_type VARCHAR(50) NOT NULL, name VARCHAR(150) NOT NULL, description TEXT,
 destination TEXT, destination_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 is_default BOOLEAN NOT NULL DEFAULT false, enabled BOOLEAN NOT NULL DEFAULT true,
 created_by UUID REFERENCES users(id) ON DELETE SET NULL, updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_project_alert_channels_active ON project_alert_channels(organization_id,project_id,channel_type) WHERE enabled AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_alert_channel_default ON project_alert_channels(project_id,channel_type) WHERE is_default AND enabled AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS project_member_alert_channel_preferences (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_alert_channel_id UUID NOT NULL REFERENCES project_alert_channels(id) ON DELETE CASCADE,
 category VARCHAR(100) NOT NULL DEFAULT 'all', severity_threshold VARCHAR(20) NOT NULL DEFAULT 'warning', enabled BOOLEAN NOT NULL DEFAULT true,
 digest_mode VARCHAR(30) NOT NULL DEFAULT 'immediate', quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(project_id,user_id,project_alert_channel_id,category)
);
ALTER TABLE project_member_alert_channel_preferences ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_member_alert_preferences_delivery
  ON project_member_alert_channel_preferences(project_id,user_id,enabled,severity_threshold) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS project_notification_preferences (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, category VARCHAR(100) NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT true, severity_threshold VARCHAR(20) NOT NULL DEFAULT 'warning',
 default_channel_ids UUID[] NOT NULL DEFAULT '{}'::uuid[], default_member_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
 role_targets project_member_role[] NOT NULL DEFAULT ARRAY['owner','admin']::project_member_role[],
 quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb, digest_mode VARCHAR(30) NOT NULL DEFAULT 'immediate',
 escalation_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(project_id,category)
);
ALTER TABLE project_notification_preferences ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_project_notification_preferences_enabled
  ON project_notification_preferences(organization_id,project_id,enabled) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS project_connector_subscriptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 connector_id UUID NOT NULL REFERENCES connector_configs(id) ON DELETE CASCADE, enabled BOOLEAN NOT NULL DEFAULT true,
 alert_categories TEXT[] NOT NULL DEFAULT '{}'::text[], severity_threshold VARCHAR(20) NOT NULL DEFAULT 'warning',
 member_ids UUID[] NOT NULL DEFAULT '{}'::uuid[], channel_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
 quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb, digest_mode VARCHAR(30) NOT NULL DEFAULT 'immediate',
 created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL, updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_connector_subscription ON project_connector_subscriptions(project_id,connector_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_connector_subscriptions_route ON project_connector_subscriptions(organization_id,project_id,enabled,severity_threshold) WHERE deleted_at IS NULL;

DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='connector_configs' AND column_name='project_id') THEN
  IF EXISTS (
    SELECT 1 FROM connector_configs c
    LEFT JOIN projects p ON p.id=c.project_id
    WHERE c.project_id IS NOT NULL AND (p.id IS NULL OR p.org_id<>c.organization_id)
  ) THEN
    RAISE EXCEPTION 'connector_configs contains cross-tenant or orphaned project ownership; repair before subscription backfill';
  END IF;
  EXECUTE $sql$INSERT INTO project_connector_subscriptions(project_id,organization_id,connector_id,enabled,created_by_user_id,updated_by_user_id)
    SELECT c.project_id,c.organization_id,c.id,c.status='active',c.created_by,c.updated_by
    FROM connector_configs c JOIN projects p ON p.id=c.project_id AND p.org_id=c.organization_id
    WHERE c.project_id IS NOT NULL
    ON CONFLICT DO NOTHING$sql$;
  DROP INDEX IF EXISTS idx_connector_project;
  ALTER TABLE connector_configs DROP COLUMN project_id;
 END IF;
END $$;

INSERT INTO project_notification_preferences(organization_id,project_id,category)
SELECT org_id,id,'all' FROM projects ON CONFLICT(project_id,category) DO NOTHING;
INSERT INTO project_alert_thresholds(organization_id,project_id,threshold_key,metric_name,metric_source,category,severity,comparison_operator,threshold_value,threshold_unit,evaluation_window_minutes,cooldown_minutes,consecutive_breaches)
SELECT p.org_id,p.id,t.threshold_key,t.metric_name,'project_usage','performance',t.severity,'>=',t.threshold_value,t.threshold_unit,5,15,1
FROM projects p CROSS JOIN (VALUES
 ('latency_p50','latency_ms_p50','warning',500::numeric,'ms'),
 ('latency_p75','latency_ms_p75','warning',750::numeric,'ms'),
 ('latency_p90','latency_ms_p90','warning',1000::numeric,'ms'),
 ('latency_p95','latency_ms_p95','error',1500::numeric,'ms'),
 ('latency_p99','latency_ms_p99','critical',2500::numeric,'ms'),
 ('error_rate','error_rate','error',5::numeric,'percent'),
 ('apdex','apdex','warning',0.85::numeric,'score'),
 ('event_volume_spike','total_events','warning',200::numeric,'percent'),
 ('event_volume_drop','total_events','warning',50::numeric,'percent'),
 ('failed_notification_rate','failed_notifications','error',10::numeric,'percent'),
 ('ingestion_error_rate','ingestion_errors','error',5::numeric,'percent'),
 ('rate_limit_usage','rate_limit_usage','warning',80::numeric,'percent'),
 ('ai_usage_cost','ai_cost','warning',100::numeric,'currency')
) t(threshold_key,metric_name,severity,threshold_value,threshold_unit)
WHERE NOT EXISTS(SELECT 1 FROM project_alert_thresholds x WHERE x.project_id=p.id AND x.environment_id IS NULL AND x.threshold_key=t.threshold_key AND x.deleted_at IS NULL);
COMMENT ON TABLE project_alert_thresholds IS 'Project-specific alert evaluation thresholds, optionally scoped to an environment.';
COMMENT ON TABLE project_alert_channels IS 'Project delivery destinations backed by organization-owned connectors when credentials are required.';
COMMENT ON TABLE project_connector_subscriptions IS 'Project routing over organization-owned connector credentials; replaces connector_configs.project_id.';
COMMENT ON TABLE project_member_alert_channel_preferences IS 'Only active project members are valid recipients; enforced by tenant-integrity trigger.';
COMMENT ON TABLE project_notification_preferences IS 'Project-level alert defaults; member channel preferences remain independently queryable.';
COMMIT;
