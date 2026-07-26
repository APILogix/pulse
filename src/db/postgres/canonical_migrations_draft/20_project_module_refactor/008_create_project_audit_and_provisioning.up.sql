BEGIN;

CREATE TABLE IF NOT EXISTS project_activity (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL, actor_api_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
 activity_type VARCHAR(100) NOT NULL, category VARCHAR(100) NOT NULL DEFAULT 'project', summary TEXT NOT NULL,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_activity_timeline ON project_activity(organization_id,project_id,occurred_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS project_audit_logs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL, actor_api_key_id UUID REFERENCES project_api_keys(id) ON DELETE SET NULL,
 action VARCHAR(100) NOT NULL, resource_type VARCHAR(100) NOT NULL, resource_id UUID,
 old_values JSONB, new_values JSONB, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 request_id VARCHAR(128), ip_address INET, user_agent TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_audit_timeline ON project_audit_logs(organization_id,project_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_project_audit_resource ON project_audit_logs(project_id,resource_type,resource_id,created_at DESC);

CREATE OR REPLACE FUNCTION reject_project_history_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '% is immutable',TG_TABLE_NAME USING ERRCODE='55000'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_project_activity_immutable ON project_activity;
CREATE TRIGGER trg_project_activity_immutable BEFORE UPDATE OR DELETE ON project_activity FOR EACH ROW EXECUTE FUNCTION reject_project_history_mutation();
DROP TRIGGER IF EXISTS trg_project_audit_logs_immutable ON project_audit_logs;
CREATE TRIGGER trg_project_audit_logs_immutable BEFORE UPDATE OR DELETE ON project_audit_logs FOR EACH ROW EXECUTE FUNCTION reject_project_history_mutation();

CREATE OR REPLACE FUNCTION enforce_project_tenant_integrity() RETURNS trigger AS $$
DECLARE expected_org UUID; value_id UUID;
BEGIN
 SELECT org_id INTO expected_org FROM projects WHERE id=NEW.project_id;
 IF expected_org IS NULL OR expected_org<>NEW.organization_id THEN RAISE EXCEPTION 'project/organization tenant mismatch'; END IF;
 value_id:=NULLIF(to_jsonb(NEW)->>'environment_id','')::uuid;
 IF value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_environments WHERE id=value_id AND project_id=NEW.project_id AND organization_id=NEW.organization_id AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'environment tenant mismatch'; END IF;
 value_id:=NULLIF(to_jsonb(NEW)->>'api_key_id','')::uuid;
 IF value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_api_keys WHERE id=value_id AND project_id=NEW.project_id AND organization_id=NEW.organization_id)
  THEN RAISE EXCEPTION 'API key tenant mismatch'; END IF;
 value_id:=NULLIF(to_jsonb(NEW)->>'connector_id','')::uuid;
 IF value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM connector_configs WHERE id=value_id AND organization_id=NEW.organization_id)
  THEN RAISE EXCEPTION 'connector tenant mismatch'; END IF;
 value_id:=NULLIF(to_jsonb(NEW)->>'role_id','')::uuid;
 IF value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_roles WHERE id=value_id AND project_id=NEW.project_id AND organization_id=NEW.organization_id)
  THEN RAISE EXCEPTION 'role tenant mismatch'; END IF;
 value_id:=NULLIF(to_jsonb(NEW)->>'project_alert_channel_id','')::uuid;
 IF value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_alert_channels WHERE id=value_id AND project_id=NEW.project_id AND organization_id=NEW.organization_id AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'alert channel tenant mismatch'; END IF;
 IF TG_TABLE_NAME='project_members' AND NOT EXISTS(
   SELECT 1 FROM project_roles WHERE id=(to_jsonb(NEW)->>'role_id')::uuid AND project_id=NEW.project_id
    AND organization_id=NEW.organization_id AND slug=to_jsonb(NEW)->>'role') THEN
   RAISE EXCEPTION 'member role and role_id mismatch';
 END IF;
 IF TG_TABLE_NAME='project_member_alert_channel_preferences'
    AND (to_jsonb(NEW)->>'deleted_at') IS NULL AND NOT EXISTS(
   SELECT 1 FROM project_members WHERE project_id=NEW.project_id AND organization_id=NEW.organization_id
    AND user_id=(to_jsonb(NEW)->>'user_id')::uuid AND status='active') THEN
   RAISE EXCEPTION 'alert recipient is not an active project member';
 END IF;
 IF TG_TABLE_NAME='project_notification_preferences'
    AND (to_jsonb(NEW)->>'deleted_at') IS NULL AND EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(to_jsonb(NEW)->'default_member_ids') AS member(value)
   WHERE NOT EXISTS(SELECT 1 FROM project_members WHERE project_id=NEW.project_id AND organization_id=NEW.organization_id
     AND user_id=member.value::uuid AND status='active')) THEN
   RAISE EXCEPTION 'default alert recipient is not an active project member';
 END IF;
 IF TG_TABLE_NAME='project_notification_preferences'
    AND (to_jsonb(NEW)->>'deleted_at') IS NULL AND EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(to_jsonb(NEW)->'default_channel_ids') AS channel(value)
   WHERE NOT EXISTS(SELECT 1 FROM project_alert_channels WHERE id=channel.value::uuid AND project_id=NEW.project_id
     AND organization_id=NEW.organization_id AND enabled AND deleted_at IS NULL)) THEN
   RAISE EXCEPTION 'default alert channel tenant mismatch or inactive channel';
 END IF;
 IF TG_TABLE_NAME='project_connector_subscriptions'
    AND (to_jsonb(NEW)->>'deleted_at') IS NULL AND EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(to_jsonb(NEW)->'member_ids') AS member(value)
   WHERE NOT EXISTS(SELECT 1 FROM project_members WHERE project_id=NEW.project_id AND organization_id=NEW.organization_id
     AND user_id=member.value::uuid AND status='active')) THEN
   RAISE EXCEPTION 'connector alert recipient is not an active project member';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;

DO $$
DECLARE table_name TEXT;
BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'project_settings','project_environments','project_roles','project_members','project_member_invitations','project_releases','project_api_keys',
  'api_key_usage_minute','api_key_usage_hourly','api_key_usage_daily','api_key_usage_monthly','project_usage_minute','project_usage_hourly','project_usage_daily',
  'project_usage_monthly','project_usage_current','project_alert_thresholds','project_alert_channels',
  'project_member_alert_channel_preferences','project_notification_preferences','project_connector_subscriptions','project_activity','project_audit_logs'
 ] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I','trg_'||table_name||'_tenant',table_name);
  EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_project_tenant_integrity()','trg_'||table_name||'_tenant',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY[
  'projects','project_settings','project_environments','project_roles','project_members','project_member_invitations','project_releases','project_api_keys',
  'api_key_usage_minute','api_key_usage_hourly','api_key_usage_daily','api_key_usage_monthly','project_usage_minute','project_usage_hourly','project_usage_daily',
  'project_usage_monthly','project_usage_current','project_alert_thresholds','project_alert_channels',
  'project_member_alert_channel_preferences','project_notification_preferences','project_connector_subscriptions'
 ] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I','trg_'||table_name||'_updated_at',table_name);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()','trg_'||table_name||'_updated_at',table_name);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION provision_project_schema_defaults() RETURNS trigger AS $$
DECLARE owner_role_id UUID;
BEGIN
 INSERT INTO project_settings(project_id,organization_id) VALUES(NEW.id,NEW.org_id) ON CONFLICT(project_id) DO NOTHING;
 INSERT INTO project_environments(project_id,organization_id,name,slug,description,is_default,color,created_by_user_id)
 VALUES
  (NEW.id,NEW.org_id,'Production','production','Production telemetry',true,'#16A34A',NEW.created_by),
  (NEW.id,NEW.org_id,'Staging','staging','Pre-production telemetry',false,'#D97706',NEW.created_by),
  (NEW.id,NEW.org_id,'Development','development','Development telemetry',false,'#2563EB',NEW.created_by)
 ON CONFLICT DO NOTHING;
 INSERT INTO project_roles(project_id,organization_id,name,slug,description,is_system,is_default,permissions) VALUES
  (NEW.id,NEW.org_id,'Owner','owner','Full project control',true,false,'["*"]'),
  (NEW.id,NEW.org_id,'Admin','admin','Project administration',true,false,'["project:read","project:write","members:manage","alerts:manage"]'),
  (NEW.id,NEW.org_id,'Developer','developer','Develop and ingest',true,false,'["project:read","events:write","analytics:read"]'),
  (NEW.id,NEW.org_id,'QA','qa','Quality assurance',true,false,'["project:read","events:write","analytics:read","alerts:read"]'),
  (NEW.id,NEW.org_id,'Viewer','viewer','Read-only project access',true,true,'["project:read","analytics:read","alerts:read"]')
 ON CONFLICT(project_id,slug) DO NOTHING;
 SELECT id INTO owner_role_id FROM project_roles WHERE project_id=NEW.id AND slug='owner';
 IF NEW.created_by IS NOT NULL THEN
  INSERT INTO project_members(project_id,organization_id,user_id,role,role_id,status,added_by_user_id,added_at)
  VALUES(NEW.id,NEW.org_id,NEW.created_by,'owner',owner_role_id,'active',NEW.created_by,NOW()) ON CONFLICT(project_id,user_id) DO NOTHING;
 END IF;
 INSERT INTO project_usage_current(project_id,organization_id) VALUES(NEW.id,NEW.org_id) ON CONFLICT(project_id) DO NOTHING;
 INSERT INTO project_notification_preferences(organization_id,project_id,category) VALUES(NEW.org_id,NEW.id,'all') ON CONFLICT(project_id,category) DO NOTHING;
 INSERT INTO project_alert_thresholds(organization_id,project_id,threshold_key,metric_name,metric_source,category,severity,comparison_operator,threshold_value,threshold_unit,evaluation_window_minutes,cooldown_minutes,consecutive_breaches)
 SELECT NEW.org_id,NEW.id,t.threshold_key,t.metric_name,'project_usage',t.category,t.severity,t.comparison_operator,t.threshold_value,t.threshold_unit,t.evaluation_window_minutes,t.cooldown_minutes,t.consecutive_breaches
 FROM (VALUES
  ('latency_p50','latency_ms_p50','performance','warning','>=',500::numeric,'ms',5,15,1),
  ('latency_p75','latency_ms_p75','performance','warning','>=',750::numeric,'ms',5,15,1),
  ('latency_p90','latency_ms_p90','performance','warning','>=',1000::numeric,'ms',5,15,1),
  ('latency_p95','latency_ms_p95','performance','error','>=',1500::numeric,'ms',5,15,1),
  ('latency_p99','latency_ms_p99','performance','critical','>=',2500::numeric,'ms',5,15,1),
  ('error_rate','error_rate','errors','error','>=',5::numeric,'percent',5,15,1),
  ('apdex','apdex','performance','warning','<=',0.85::numeric,'score',5,15,1),
  ('event_volume_spike','total_events','volume','warning','>=',200::numeric,'percent',5,15,1),
  ('event_volume_drop','total_events','volume','warning','<=',50::numeric,'percent',5,15,1),
  ('failed_notification_rate','failed_notifications','notifications','error','>=',10::numeric,'percent',5,15,1),
  ('ingestion_error_rate','ingestion_errors','ingestion','error','>=',5::numeric,'percent',5,15,1),
  ('rate_limit_usage','rate_limit_usage','ingestion','warning','>=',80::numeric,'percent',5,15,1),
  ('ai_usage_cost','ai_cost','ai','warning','>=',100::numeric,'currency',60,60,1)
 ) AS t(threshold_key,metric_name,category,severity,comparison_operator,threshold_value,threshold_unit,evaluation_window_minutes,cooldown_minutes,consecutive_breaches)
 ON CONFLICT DO NOTHING;
 INSERT INTO project_activity(organization_id,project_id,actor_user_id,activity_type,summary) VALUES(NEW.org_id,NEW.id,NEW.created_by,'project.created','Project created');
 INSERT INTO project_audit_logs(organization_id,project_id,actor_user_id,action,resource_type,resource_id,new_values)
 VALUES(NEW.org_id,NEW.id,NEW.created_by,'project.created','project',NEW.id,jsonb_build_object('name',NEW.name,'slug',NEW.slug));
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_projects_provision_defaults ON projects;
CREATE TRIGGER trg_projects_provision_defaults AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION provision_project_schema_defaults();
COMMENT ON FUNCTION provision_project_schema_defaults() IS 'Schema safety net for atomic dependent-row provisioning; application transactions may pre-provision with ON CONFLICT semantics.';
COMMENT ON TABLE project_audit_logs IS 'Append-only project compliance history; update and delete are rejected.';
COMMIT;
