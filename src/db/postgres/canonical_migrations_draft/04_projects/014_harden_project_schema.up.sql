BEGIN;

-- Canonical credentials: replace any non-platform legacy lookup value and
-- preserve only a one-way secret verifier.
UPDATE project_api_keys
SET public_key = 'pulsiv_legacy_' || replace(id::text, '-', ''),
    status = CASE WHEN status = 'active' THEN 'rotated'::api_key_status ELSE status END,
    is_active = false,
    rotated_at = COALESCE(rotated_at, NOW()),
    rotation_state = 'completed',
    rotation_reason = COALESCE(rotation_reason, 'Non-canonical legacy public key requires rotation'),
    updated_at = NOW()
WHERE public_key !~ '^pulsiv_[a-z0-9][a-z0-9_-]{10,127}$';

UPDATE project_api_keys
SET is_active = (status = 'active'),
    revoked_at = CASE WHEN status = 'revoked' THEN COALESCE(revoked_at, updated_at, NOW()) ELSE revoked_at END,
    rotated_at = CASE WHEN status = 'rotated' THEN COALESCE(rotated_at, updated_at, NOW()) ELSE rotated_at END,
    rotation_state = CASE WHEN status = 'rotated' THEN 'completed'::api_key_rotation_state ELSE rotation_state END;

ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS project_api_keys_public_key_format_check;
ALTER TABLE project_api_keys ADD CONSTRAINT project_api_keys_public_key_format_check
  CHECK (public_key ~ '^pulsiv_[a-z0-9][a-z0-9_-]{10,127}$');
ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS project_api_keys_secret_hash_check;
ALTER TABLE project_api_keys ADD CONSTRAINT project_api_keys_secret_hash_check CHECK (length(btrim(secret_hash)) >= 20);
ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS project_api_keys_lifecycle_check;
ALTER TABLE project_api_keys ADD CONSTRAINT project_api_keys_lifecycle_check CHECK (
  (NOT is_active OR status = 'active')
  AND (status <> 'revoked' OR (revoked_at IS NOT NULL AND NOT is_active))
  AND (status <> 'rotated' OR (rotated_at IS NOT NULL AND NOT is_active AND rotation_state = 'completed'))
  AND (rotation_state <> 'grace_period' OR grace_period_ends_at IS NOT NULL)
  AND (rotated_from_key_id IS NULL OR rotated_from_key_id <> id)
  AND (expires_at IS NULL OR expires_at > created_at)
  AND (NOT auto_rotate_enabled OR auto_rotate_days IS NOT NULL)
);

-- API-key usage uses `events`; `total_events` is reserved for project rollups.
DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['api_key_usage_minute','api_key_usage_hourly','api_key_usage_daily','api_key_usage_monthly'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema='public' AND c.table_name=v_table AND c.column_name='total_events')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                       WHERE c.table_schema='public' AND c.table_name=v_table AND c.column_name='events') THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN total_events TO events', v_table);
    END IF;
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1', v_table);
  END LOOP;
END $$;

DO $$
DECLARE v_table TEXT; v_bucket_check TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['api_key_usage_minute','api_key_usage_hourly','api_key_usage_daily','api_key_usage_monthly'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', v_table, v_table || '_bucket_check');
    v_bucket_check := CASE v_table
      WHEN 'api_key_usage_minute' THEN 'bucket = date_trunc(''minute'', bucket)'
      WHEN 'api_key_usage_hourly' THEN 'bucket = date_trunc(''hour'', bucket)'
      WHEN 'api_key_usage_daily' THEN 'bucket = date_trunc(''day'', bucket)::date'
      ELSE 'bucket = date_trunc(''month'', bucket)::date'
    END;
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', v_table, v_table || '_bucket_check', v_bucket_check);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', v_table, v_table || '_latency_check');
    EXECUTE format($ddl$ALTER TABLE %I ADD CONSTRAINT %I CHECK (
      events >= 0 AND requests >= 0 AND errors >= 0 AND bytes_ingested >= 0 AND rate_limited >= 0
      AND (latency_ms_p50 IS NULL OR latency_ms_p50 >= 0)
      AND (latency_ms_p95 IS NULL OR latency_ms_p95 >= 0)
      AND (latency_ms_p99 IS NULL OR latency_ms_p99 >= 0)
      AND (latency_ms_p50 IS NULL OR latency_ms_p95 IS NULL OR latency_ms_p50 <= latency_ms_p95)
      AND (latency_ms_p95 IS NULL OR latency_ms_p99 IS NULL OR latency_ms_p95 <= latency_ms_p99)
    )$ddl$, v_table, v_table || '_latency_check');
  END LOOP;
END $$;

-- Every project usage grain exposes `bucket` and `total_events`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='project_usage_monthly' AND column_name='year_month')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='project_usage_monthly' AND column_name='bucket') THEN
    ALTER TABLE project_usage_monthly RENAME COLUMN year_month TO bucket;
  END IF;
END $$;

ALTER TABLE project_usage_monthly DROP CONSTRAINT IF EXISTS project_usage_monthly_year_month_key;
ALTER TABLE project_usage_monthly DROP CONSTRAINT IF EXISTS project_usage_monthly_year_month_check;
ALTER TABLE project_usage_monthly DROP CONSTRAINT IF EXISTS project_usage_monthly_bucket_check;
ALTER TABLE project_usage_monthly ADD CONSTRAINT project_usage_monthly_bucket_check
  CHECK (bucket = date_trunc('month', bucket)::date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_usage_monthly_bucket ON project_usage_monthly(project_id, bucket);
DROP INDEX IF EXISTS idx_project_usage_monthly_org;
CREATE INDEX IF NOT EXISTS idx_project_usage_monthly_org_bucket
  ON project_usage_monthly(organization_id, bucket DESC);

DO $$
DECLARE v_table TEXT; v_grain TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['project_usage_minute','project_usage_hourly','project_usage_daily'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS latency_ms_p75 NUMERIC(12,3)', v_table);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS latency_ms_p90 NUMERIC(12,3)', v_table);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1', v_table);
    v_grain := CASE v_table WHEN 'project_usage_minute' THEN 'minute' WHEN 'project_usage_hourly' THEN 'hour' ELSE 'day' END;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', v_table, v_table || '_bucket_check');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (bucket = date_trunc(%L, bucket))', v_table, v_table || '_bucket_check', v_grain);
  END LOOP;
END $$;

ALTER TABLE project_usage_monthly ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE project_usage_current ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE project_usage_current DROP CONSTRAINT IF EXISTS project_usage_current_nonnegative_check;
ALTER TABLE project_usage_current ADD CONSTRAINT project_usage_current_nonnegative_check CHECK (
  total_events >= 0 AND errors >= 0 AND requests >= 0 AND traces >= 0 AND logs >= 0
  AND metrics >= 0 AND profiles >= 0 AND alert_count >= 0 AND connector_deliveries >= 0
  AND failed_notifications >= 0
);

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['project_usage_minute','project_usage_hourly','project_usage_daily'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', v_table, v_table || '_enterprise_metrics_check');
    EXECUTE format($ddl$ALTER TABLE %I ADD CONSTRAINT %I CHECK (
      active_api_keys >= 0 AND active_environments >= 0 AND active_users >= 0 AND active_members >= 0
      AND alert_count >= 0 AND connector_deliveries >= 0 AND failed_notifications >= 0
      AND rate_limit_usage >= 0
      AND (latency_ms_p50 IS NULL OR latency_ms_p50 >= 0)
      AND (latency_ms_p75 IS NULL OR latency_ms_p75 >= 0)
      AND (latency_ms_p90 IS NULL OR latency_ms_p90 >= 0)
      AND (latency_ms_p95 IS NULL OR latency_ms_p95 >= 0)
      AND (latency_ms_p99 IS NULL OR latency_ms_p99 >= 0)
      AND (latency_ms_p50 IS NULL OR latency_ms_p75 IS NULL OR latency_ms_p50 <= latency_ms_p75)
      AND (latency_ms_p75 IS NULL OR latency_ms_p90 IS NULL OR latency_ms_p75 <= latency_ms_p90)
      AND (latency_ms_p90 IS NULL OR latency_ms_p95 IS NULL OR latency_ms_p90 <= latency_ms_p95)
      AND (latency_ms_p95 IS NULL OR latency_ms_p99 IS NULL OR latency_ms_p95 <= latency_ms_p99)
    )$ddl$, v_table, v_table || '_enterprise_metrics_check');
  END LOOP;
END $$;

-- Soft-deletable routing preferences use active-row uniqueness.
DO $$
DECLARE v_constraint TEXT;
BEGIN
  FOR v_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='project_member_alert_channel_preferences'::regclass AND contype='u'
      AND pg_get_constraintdef(oid) LIKE 'UNIQUE (project_id, user_id, project_alert_channel_id, category)%'
  LOOP
    EXECUTE format('ALTER TABLE project_member_alert_channel_preferences DROP CONSTRAINT %I', v_constraint);
  END LOOP;
  FOR v_constraint IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='project_notification_preferences'::regclass AND contype='u'
      AND pg_get_constraintdef(oid) LIKE 'UNIQUE (project_id, category)%'
  LOOP
    EXECUTE format('ALTER TABLE project_notification_preferences DROP CONSTRAINT %I', v_constraint);
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_alert_channel_preference_active
  ON project_member_alert_channel_preferences(project_id,user_id,project_alert_channel_id,category)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_notification_preference_active
  ON project_notification_preferences(project_id,category) WHERE deleted_at IS NULL;

ALTER TABLE project_alert_thresholds DROP CONSTRAINT IF EXISTS project_alert_thresholds_severity_check;
ALTER TABLE project_alert_thresholds ADD CONSTRAINT project_alert_thresholds_severity_check
  CHECK (severity IN ('info','warning','error','critical'));
ALTER TABLE project_alert_thresholds DROP CONSTRAINT IF EXISTS project_alert_thresholds_value_check;
ALTER TABLE project_alert_thresholds ADD CONSTRAINT project_alert_thresholds_value_check
  CHECK (length(btrim(threshold_key)) > 0 AND length(btrim(metric_name)) > 0 AND length(btrim(metric_source)) > 0);
ALTER TABLE project_alert_channels DROP CONSTRAINT IF EXISTS project_alert_channels_destination_check;
ALTER TABLE project_alert_channels ADD CONSTRAINT project_alert_channels_destination_check CHECK (
  length(btrim(channel_type)) > 0 AND length(btrim(name)) > 0
  AND (connector_id IS NOT NULL OR NULLIF(btrim(destination), '') IS NOT NULL)
  AND jsonb_typeof(destination_metadata) = 'object'
);
ALTER TABLE project_member_alert_channel_preferences DROP CONSTRAINT IF EXISTS project_member_alert_preferences_policy_check;
ALTER TABLE project_member_alert_channel_preferences ADD CONSTRAINT project_member_alert_preferences_policy_check CHECK (
  severity_threshold IN ('info','warning','error','critical')
  AND digest_mode IN ('immediate','hourly','daily','weekly')
  AND jsonb_typeof(quiet_hours) = 'object'
);
ALTER TABLE project_notification_preferences DROP CONSTRAINT IF EXISTS project_notification_preferences_policy_check;
ALTER TABLE project_notification_preferences ADD CONSTRAINT project_notification_preferences_policy_check CHECK (
  severity_threshold IN ('info','warning','error','critical')
  AND digest_mode IN ('immediate','hourly','daily','weekly')
  AND jsonb_typeof(quiet_hours) = 'object' AND jsonb_typeof(escalation_policy) = 'object'
);
ALTER TABLE project_connector_subscriptions DROP CONSTRAINT IF EXISTS project_connector_subscriptions_policy_check;
ALTER TABLE project_connector_subscriptions ADD CONSTRAINT project_connector_subscriptions_policy_check CHECK (
  severity_threshold IN ('info','warning','error','critical')
  AND digest_mode IN ('immediate','hourly','daily','weekly')
  AND jsonb_typeof(quiet_hours) = 'object' AND jsonb_typeof(channel_overrides) = 'object'
);

-- Correct the defaults introduced by the initial convergence step while leaving
-- explicitly user-managed rows untouched.
UPDATE project_alert_thresholds SET
  category = CASE threshold_key
    WHEN 'error_rate' THEN 'errors' WHEN 'event_volume_spike' THEN 'volume'
    WHEN 'event_volume_drop' THEN 'volume' WHEN 'failed_notification_rate' THEN 'notifications'
    WHEN 'ingestion_error_rate' THEN 'ingestion' WHEN 'rate_limit_usage' THEN 'ingestion'
    WHEN 'ai_usage_cost' THEN 'ai' ELSE 'performance' END,
  comparison_operator = CASE WHEN threshold_key IN ('apdex','event_volume_drop') THEN '<=' ELSE '>=' END,
  updated_at = NOW()
WHERE threshold_key IN (
  'latency_p50','latency_p75','latency_p90','latency_p95','latency_p99','error_rate','apdex',
  'event_volume_spike','event_volume_drop','failed_notification_rate','ingestion_error_rate','rate_limit_usage','ai_usage_cost'
) AND created_by IS NULL AND updated_by IS NULL;

-- Composite tenant keys make cross-organization references impossible even
-- when writes bypass application repositories.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_api_keys_tenant_id
  ON project_api_keys(id, project_id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_api_keys_tenant_environment
  ON project_api_keys(id, project_id, organization_id, environment_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_alert_channels_tenant_id
  ON project_alert_channels(id, project_id, organization_id);

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'project_settings','project_environments',
    'project_releases','project_api_keys','api_key_usage_minute','api_key_usage_hourly','api_key_usage_daily',
    'api_key_usage_monthly','project_usage_minute','project_usage_hourly','project_usage_daily',
    'project_usage_monthly','project_usage_current','project_alert_thresholds','project_alert_channels',
    'project_member_alert_channel_preferences','project_notification_preferences','project_connector_subscriptions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', v_table, 'fk_' || v_table || '_project_tenant');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,org_id) ON DELETE CASCADE',
                   v_table, 'fk_' || v_table || '_project_tenant');
  END LOOP;
END $$;

ALTER TABLE project_releases DROP CONSTRAINT IF EXISTS fk_project_releases_environment_tenant;
ALTER TABLE project_releases ADD CONSTRAINT fk_project_releases_environment_tenant
  FOREIGN KEY(environment_id,project_id,organization_id) REFERENCES project_environments(id,project_id,organization_id) ON DELETE RESTRICT;
ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS fk_project_api_keys_environment_tenant;
ALTER TABLE project_api_keys ADD CONSTRAINT fk_project_api_keys_environment_tenant
  FOREIGN KEY(environment_id,project_id,organization_id) REFERENCES project_environments(id,project_id,organization_id) ON DELETE RESTRICT;
ALTER TABLE project_alert_thresholds DROP CONSTRAINT IF EXISTS fk_project_thresholds_environment_tenant;
ALTER TABLE project_alert_thresholds ADD CONSTRAINT fk_project_thresholds_environment_tenant
  FOREIGN KEY(environment_id,project_id,organization_id) REFERENCES project_environments(id,project_id,organization_id) ON DELETE CASCADE;
ALTER TABLE project_member_alert_channel_preferences DROP CONSTRAINT IF EXISTS fk_member_alert_preferences_channel_tenant;
ALTER TABLE project_member_alert_channel_preferences ADD CONSTRAINT fk_member_alert_preferences_channel_tenant
  FOREIGN KEY(project_alert_channel_id,project_id,organization_id)
  REFERENCES project_alert_channels(id,project_id,organization_id) ON DELETE CASCADE;

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['api_key_usage_minute','api_key_usage_hourly','api_key_usage_daily','api_key_usage_monthly'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', v_table, 'fk_' || v_table || '_key_tenant');
    EXECUTE format($ddl$ALTER TABLE %I ADD CONSTRAINT %I
      FOREIGN KEY(api_key_id,project_id,organization_id,environment_id)
      REFERENCES project_api_keys(id,project_id,organization_id,environment_id) ON DELETE CASCADE$ddl$,
      v_table, 'fk_' || v_table || '_key_tenant');
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY['project_usage_minute','project_usage_hourly','project_usage_daily'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', v_table, 'fk_' || v_table || '_environment_tenant');
    EXECUTE format($ddl$ALTER TABLE %I ADD CONSTRAINT %I
      FOREIGN KEY(environment_id,project_id,organization_id)
      REFERENCES project_environments(id,project_id,organization_id) ON DELETE CASCADE$ddl$,
      v_table, 'fk_' || v_table || '_environment_tenant');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', v_table, 'fk_' || v_table || '_key_tenant');
    EXECUTE format($ddl$ALTER TABLE %I ADD CONSTRAINT %I
      FOREIGN KEY(api_key_id,project_id,organization_id)
      REFERENCES project_api_keys(id,project_id,organization_id) ON DELETE SET NULL (api_key_id)$ddl$,
      v_table, 'fk_' || v_table || '_key_tenant');
  END LOOP;
END $$;

-- Immutable history uses restrictive references; SET NULL/CASCADE actions
-- would otherwise invoke the mutation-rejection triggers.
ALTER TABLE project_activity
  DROP CONSTRAINT IF EXISTS project_activity_organization_id_fkey,
  DROP CONSTRAINT IF EXISTS project_activity_project_id_fkey,
  DROP CONSTRAINT IF EXISTS project_activity_actor_user_id_fkey,
  DROP CONSTRAINT IF EXISTS project_activity_actor_api_key_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_project_activity_organization,
  DROP CONSTRAINT IF EXISTS fk_project_activity_project_tenant,
  DROP CONSTRAINT IF EXISTS fk_project_activity_actor_user,
  DROP CONSTRAINT IF EXISTS fk_project_activity_actor_key_tenant;
ALTER TABLE project_activity
  ADD CONSTRAINT fk_project_activity_organization FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_project_activity_project_tenant FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,org_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_project_activity_actor_user FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_project_activity_actor_key_tenant FOREIGN KEY(actor_api_key_id,project_id,organization_id)
    REFERENCES project_api_keys(id,project_id,organization_id) ON DELETE RESTRICT;
ALTER TABLE project_audit_logs
  DROP CONSTRAINT IF EXISTS project_audit_logs_organization_id_fkey,
  DROP CONSTRAINT IF EXISTS project_audit_logs_project_id_fkey,
  DROP CONSTRAINT IF EXISTS project_audit_logs_actor_user_id_fkey,
  DROP CONSTRAINT IF EXISTS project_audit_logs_actor_api_key_id_fkey,
  DROP CONSTRAINT IF EXISTS fk_project_audit_organization,
  DROP CONSTRAINT IF EXISTS fk_project_audit_project_tenant,
  DROP CONSTRAINT IF EXISTS fk_project_audit_actor_user,
  DROP CONSTRAINT IF EXISTS fk_project_audit_actor_key_tenant;
ALTER TABLE project_audit_logs
  ADD CONSTRAINT fk_project_audit_organization FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_project_audit_project_tenant FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,org_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_project_audit_actor_user FOREIGN KEY(actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_project_audit_actor_key_tenant FOREIGN KEY(actor_api_key_id,project_id,organization_id)
    REFERENCES project_api_keys(id,project_id,organization_id) ON DELETE RESTRICT;

-- Project history is append-only and records every mutable control-plane change.
CREATE OR REPLACE FUNCTION record_project_change_history() RETURNS trigger AS $$
DECLARE
  row_new JSONB := to_jsonb(NEW);
  row_old JSONB := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  safe_new JSONB;
  safe_old JSONB;
  history_project_id UUID;
  history_org_id UUID;
  history_actor_user_id UUID;
  history_actor_api_key_id UUID;
  actor_value TEXT;
  history_action TEXT;
BEGIN
  -- project.created is already written atomically by the provisioning trigger.
  IF TG_TABLE_NAME='projects' AND TG_OP='INSERT' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND row_new = row_old THEN RETURN NEW; END IF;

  history_project_id := CASE WHEN TG_TABLE_NAME='projects' THEN (row_new->>'id')::uuid ELSE (row_new->>'project_id')::uuid END;
  history_org_id := CASE WHEN TG_TABLE_NAME='projects' THEN (row_new->>'org_id')::uuid ELSE (row_new->>'organization_id')::uuid END;
  actor_value := COALESCE(NULLIF(row_new->>'updated_by',''), NULLIF(row_new->>'created_by',''),
                          NULLIF(row_new->>'updated_by_user_id',''), NULLIF(row_new->>'created_by_user_id',''),
                          NULLIF(row_new->>'added_by_user_id',''), NULLIF(row_new->>'invited_by_user_id',''),
                          NULLIF(current_setting('app.user_id', true),''));
  IF actor_value IS NOT NULL THEN history_actor_user_id := actor_value::uuid; END IF;
  actor_value := COALESCE(NULLIF(row_new->>'created_by_api_key_id',''), NULLIF(current_setting('app.api_key_id', true),''));
  IF actor_value IS NOT NULL THEN history_actor_api_key_id := actor_value::uuid; END IF;

  safe_new := row_new - ARRAY['secret_hash','token_hash'];
  safe_old := CASE WHEN row_old IS NULL THEN NULL ELSE row_old - ARRAY['secret_hash','token_hash'] END;
  history_action := CASE WHEN TG_TABLE_NAME='projects' THEN 'project.updated'
                         ELSE TG_TABLE_NAME || CASE WHEN TG_OP='INSERT' THEN '.created' ELSE '.updated' END END;

  INSERT INTO project_audit_logs(
    organization_id,project_id,actor_user_id,actor_api_key_id,action,resource_type,resource_id,old_values,new_values
  ) VALUES (
    history_org_id,history_project_id,history_actor_user_id,history_actor_api_key_id,history_action,TG_TABLE_NAME,
    NULLIF(row_new->>'id','')::uuid,safe_old,safe_new
  );
  INSERT INTO project_activity(organization_id,project_id,actor_user_id,actor_api_key_id,activity_type,category,summary,metadata)
  VALUES(history_org_id,history_project_id,history_actor_user_id,history_actor_api_key_id,history_action,
         split_part(TG_TABLE_NAME,'_',2),replace(history_action,'.',' '),
         jsonb_build_object('resource_type',TG_TABLE_NAME,'resource_id',row_new->>'id'));
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'projects','project_settings','project_environments',
    'project_releases','project_api_keys','project_alert_thresholds','project_alert_channels',
    'project_member_alert_channel_preferences','project_notification_preferences','project_connector_subscriptions'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || v_table || '_change_history', v_table);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION record_project_change_history()',
                   'trg_' || v_table || '_change_history', v_table);
  END LOOP;
END $$;

COMMENT ON FUNCTION record_project_change_history() IS
  'Writes redacted, append-only project activity and audit history for control-plane mutations.';
COMMENT ON COLUMN project_api_keys.public_key IS
  'Server-generated Pulsiv lookup key; database format enforcement rejects user-controlled prefixes.';
COMMENT ON COLUMN project_api_keys.secret_hash IS
  'One-way secret verifier. Raw API-key material must only be returned by the application at creation or rotation.';
COMMENT ON TABLE api_key_usage_minute IS
  'Canonical minute API-key usage with key, project, organization, and environment tenant integrity.';
COMMENT ON COLUMN api_key_usage_minute.events IS 'Accepted events attributed to this API key and minute bucket.';
COMMENT ON COLUMN project_usage_monthly.bucket IS 'UTC first day of the calendar month; canonical monthly bucket.';
COMMENT ON COLUMN project_usage_monthly.total_events IS 'Canonical monthly event total.';
COMMENT ON TABLE project_audit_logs IS
  'Append-only, redacted compliance history populated by project control-plane triggers.';
COMMENT ON TABLE project_activity IS
  'Append-only project timeline populated alongside the dedicated project audit history.';

COMMIT;

-- Final runtime alignment: canonical byte metrics and dimension-aware staging.
BEGIN;

DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['project_usage_minute','project_usage_hourly','project_usage_daily'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS total_bytes BIGINT NOT NULL DEFAULT 0', v_table);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', v_table, v_table || '_total_bytes_check');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (total_bytes >= 0)', v_table, v_table || '_total_bytes_check');
  END LOOP;
END $$;

ALTER TABLE project_api_keys DROP CONSTRAINT IF EXISTS project_api_keys_lifecycle_check;
ALTER TABLE project_api_keys ADD CONSTRAINT project_api_keys_lifecycle_check CHECK (
  (
    NOT is_active
    OR status = 'active'
    OR (status = 'rotated' AND rotation_state = 'grace_period')
  )
  AND (status <> 'revoked' OR (revoked_at IS NOT NULL AND NOT is_active))
  AND (status <> 'rotated' OR (
    rotated_at IS NOT NULL
    AND (
      (rotation_state = 'grace_period' AND is_active AND grace_period_ends_at IS NOT NULL)
      OR (rotation_state = 'completed' AND NOT is_active)
    )
  ))
  AND (rotation_state <> 'grace_period' OR grace_period_ends_at IS NOT NULL)
  AND (rotated_from_key_id IS NULL OR rotated_from_key_id <> id)
  AND (expires_at IS NULL OR expires_at > created_at)
  AND (NOT auto_rotate_enabled OR auto_rotate_days IS NOT NULL)
);

CREATE OR REPLACE FUNCTION flush_usage_counters()
RETURNS TABLE(flushed_project_id UUID, flushed_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT s.id,s.project_id,s.org_id,s.api_key_id,s.event_type,
           s.counter_type,s.increment_by,s.created_at
      FROM usage_counter_staging s
     WHERE s.created_at < NOW() - INTERVAL '5 seconds'
       AND s.counter_type NOT LIKE 'billing:%'
     ORDER BY s.id
     LIMIT 10000
     FOR UPDATE SKIP LOCKED
  ), enriched AS (
    SELECT b.*,
           CASE WHEN k.project_id=b.project_id AND k.organization_id=b.org_id THEN k.environment_id END environment_id,
           CASE WHEN k.project_id=b.project_id AND k.organization_id=b.org_id THEN k.id END valid_api_key_id
      FROM batch b
      LEFT JOIN project_api_keys k ON k.id=b.api_key_id
  ), project_aggregated AS (
    SELECT org_id,project_id,environment_id,valid_api_key_id,date_trunc('minute',created_at) bucket,
           COALESCE(SUM(increment_by) FILTER(WHERE counter_type='events'),0)::BIGINT total_events,
           COALESCE(SUM(increment_by) FILTER(WHERE counter_type='errors'),0)::BIGINT errors,
           COALESCE(SUM(increment_by) FILTER(WHERE counter_type='requests'),0)::BIGINT requests,
           COALESCE(SUM(increment_by) FILTER(WHERE counter_type='bytes_ingested'),0)::BIGINT total_bytes,
           COALESCE(SUM(increment_by) FILTER(WHERE counter_type='rate_limited'),0)::NUMERIC rate_limit_usage
      FROM enriched
     GROUP BY org_id,project_id,environment_id,valid_api_key_id,date_trunc('minute',created_at)
  ), project_upsert AS (
    INSERT INTO project_usage_minute(
      organization_id,project_id,environment_id,api_key_id,bucket,
      total_events,errors,requests,total_bytes,rate_limit_usage
    )
    SELECT org_id,project_id,environment_id,valid_api_key_id,bucket,
           total_events,errors,requests,total_bytes,rate_limit_usage
      FROM project_aggregated
    ON CONFLICT(organization_id,project_id,environment_id,api_key_id,bucket) DO UPDATE SET
      total_events=project_usage_minute.total_events+EXCLUDED.total_events,
      errors=project_usage_minute.errors+EXCLUDED.errors,
      requests=project_usage_minute.requests+EXCLUDED.requests,
      total_bytes=project_usage_minute.total_bytes+EXCLUDED.total_bytes,
      rate_limit_usage=project_usage_minute.rate_limit_usage+EXCLUDED.rate_limit_usage,
      updated_at=NOW()
    RETURNING project_id
  ), key_aggregated AS (
    SELECT valid_api_key_id api_key_id,project_id,org_id organization_id,environment_id,
           date_trunc('minute',created_at) bucket,event_type,
           COALESCE(SUM(increment_by) FILTER(WHERE counter_type='requests'),0)::BIGINT requests,
           COALESCE(SUM(increment_by) FILTER(WHERE counter_type='events'),0)::BIGINT events,
           COALESCE(SUM(increment_by) FILTER(WHERE counter_type='errors'),0)::BIGINT errors,
           COALESCE(SUM(increment_by) FILTER(WHERE counter_type='bytes_ingested'),0)::BIGINT bytes_ingested,
           COALESCE(SUM(increment_by) FILTER(WHERE counter_type='rate_limited'),0)::BIGINT rate_limited
      FROM enriched
     WHERE valid_api_key_id IS NOT NULL AND environment_id IS NOT NULL
     GROUP BY valid_api_key_id,project_id,org_id,environment_id,date_trunc('minute',created_at),event_type
  ), key_upsert AS (
    INSERT INTO api_key_usage_minute(
      api_key_id,project_id,organization_id,environment_id,bucket,event_type,
      requests,events,errors,bytes_ingested,rate_limited
    )
    SELECT api_key_id,project_id,organization_id,environment_id,bucket,event_type,
           requests,events,errors,bytes_ingested,rate_limited
      FROM key_aggregated
    ON CONFLICT(api_key_id,bucket,event_type) DO UPDATE SET
      requests=api_key_usage_minute.requests+EXCLUDED.requests,
      events=api_key_usage_minute.events+EXCLUDED.events,
      errors=api_key_usage_minute.errors+EXCLUDED.errors,
      bytes_ingested=api_key_usage_minute.bytes_ingested+EXCLUDED.bytes_ingested,
      rate_limited=api_key_usage_minute.rate_limited+EXCLUDED.rate_limited,
      updated_at=NOW()
    RETURNING project_id
  ), deleted AS (
    DELETE FROM usage_counter_staging s USING batch b WHERE s.id=b.id RETURNING s.project_id
  )
  SELECT deleted.project_id,COUNT(*)::BIGINT FROM deleted GROUP BY deleted.project_id;
END; $$ LANGUAGE plpgsql;

COMMIT;

-- Durable evaluator state for scheduled project-threshold processing.
BEGIN;
ALTER TABLE project_alert_thresholds
  ADD COLUMN IF NOT EXISTS current_breaches INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_breaching BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ;
ALTER TABLE project_alert_thresholds DROP CONSTRAINT IF EXISTS project_alert_thresholds_breach_state_check;
ALTER TABLE project_alert_thresholds ADD CONSTRAINT project_alert_thresholds_breach_state_check
  CHECK (current_breaches >= 0);
CREATE INDEX IF NOT EXISTS idx_project_thresholds_due
  ON project_alert_thresholds(last_evaluated_at, evaluation_window_minutes)
  WHERE enabled AND deleted_at IS NULL;
COMMENT ON COLUMN project_alert_thresholds.current_breaches IS 'Durable consecutive breach count used by the scheduled project threshold evaluator.';
COMMENT ON COLUMN project_alert_thresholds.is_breaching IS 'Current recovery state; transitions to false only after a clear evaluation.';
COMMENT ON COLUMN project_alert_thresholds.last_evaluated_at IS 'Watermark for bounded scheduled evaluation.';
COMMIT;


-- Idempotent minute -> hour -> day -> month aggregation for project and API-key analytics.
BEGIN;
CREATE OR REPLACE FUNCTION rollup_project_usage() RETURNS VOID AS $$
BEGIN
  INSERT INTO project_usage_hourly(
    organization_id,project_id,environment_id,api_key_id,bucket,total_events,errors,requests,
    transactions,traces,spans,logs,metrics,profiles,ai_events,sdk_requests,total_bytes,
    active_api_keys,active_environments,active_users,active_members,alert_count,
    connector_deliveries,failed_notifications,rate_limit_usage,
    latency_ms_p50,latency_ms_p75,latency_ms_p90,latency_ms_p95,latency_ms_p99
  )
  SELECT organization_id,project_id,environment_id,api_key_id,date_trunc('hour',bucket),
    SUM(total_events),SUM(errors),SUM(requests),SUM(transactions),SUM(traces),SUM(spans),
    SUM(logs),SUM(metrics),SUM(profiles),SUM(ai_events),SUM(sdk_requests),SUM(total_bytes),
    MAX(active_api_keys),MAX(active_environments),MAX(active_users),MAX(active_members),
    SUM(alert_count),SUM(connector_deliveries),SUM(failed_notifications),SUM(rate_limit_usage),
    MAX(latency_ms_p50),MAX(latency_ms_p75),MAX(latency_ms_p90),MAX(latency_ms_p95),MAX(latency_ms_p99)
  FROM project_usage_minute
  GROUP BY organization_id,project_id,environment_id,api_key_id,date_trunc('hour',bucket)
  ON CONFLICT(organization_id,project_id,environment_id,api_key_id,bucket) DO UPDATE SET
    total_events=EXCLUDED.total_events,errors=EXCLUDED.errors,requests=EXCLUDED.requests,
    transactions=EXCLUDED.transactions,traces=EXCLUDED.traces,spans=EXCLUDED.spans,
    logs=EXCLUDED.logs,metrics=EXCLUDED.metrics,profiles=EXCLUDED.profiles,
    ai_events=EXCLUDED.ai_events,sdk_requests=EXCLUDED.sdk_requests,total_bytes=EXCLUDED.total_bytes,
    active_api_keys=EXCLUDED.active_api_keys,active_environments=EXCLUDED.active_environments,
    active_users=EXCLUDED.active_users,active_members=EXCLUDED.active_members,
    alert_count=EXCLUDED.alert_count,connector_deliveries=EXCLUDED.connector_deliveries,
    failed_notifications=EXCLUDED.failed_notifications,rate_limit_usage=EXCLUDED.rate_limit_usage,
    latency_ms_p50=EXCLUDED.latency_ms_p50,latency_ms_p75=EXCLUDED.latency_ms_p75,
    latency_ms_p90=EXCLUDED.latency_ms_p90,latency_ms_p95=EXCLUDED.latency_ms_p95,
    latency_ms_p99=EXCLUDED.latency_ms_p99,updated_at=NOW(),version=project_usage_hourly.version+1;

  INSERT INTO project_usage_daily(
    organization_id,project_id,environment_id,api_key_id,bucket,total_events,errors,requests,
    transactions,traces,spans,logs,metrics,profiles,ai_events,sdk_requests,total_bytes,
    active_api_keys,active_environments,active_users,active_members,alert_count,
    connector_deliveries,failed_notifications,rate_limit_usage,
    latency_ms_p50,latency_ms_p75,latency_ms_p90,latency_ms_p95,latency_ms_p99
  )
  SELECT organization_id,project_id,environment_id,api_key_id,date_trunc('day',bucket),
    SUM(total_events),SUM(errors),SUM(requests),SUM(transactions),SUM(traces),SUM(spans),
    SUM(logs),SUM(metrics),SUM(profiles),SUM(ai_events),SUM(sdk_requests),SUM(total_bytes),
    MAX(active_api_keys),MAX(active_environments),MAX(active_users),MAX(active_members),
    SUM(alert_count),SUM(connector_deliveries),SUM(failed_notifications),SUM(rate_limit_usage),
    MAX(latency_ms_p50),MAX(latency_ms_p75),MAX(latency_ms_p90),MAX(latency_ms_p95),MAX(latency_ms_p99)
  FROM project_usage_hourly
  GROUP BY organization_id,project_id,environment_id,api_key_id,date_trunc('day',bucket)
  ON CONFLICT(organization_id,project_id,environment_id,api_key_id,bucket) DO UPDATE SET
    total_events=EXCLUDED.total_events,errors=EXCLUDED.errors,requests=EXCLUDED.requests,
    transactions=EXCLUDED.transactions,traces=EXCLUDED.traces,spans=EXCLUDED.spans,
    logs=EXCLUDED.logs,metrics=EXCLUDED.metrics,profiles=EXCLUDED.profiles,
    ai_events=EXCLUDED.ai_events,sdk_requests=EXCLUDED.sdk_requests,total_bytes=EXCLUDED.total_bytes,
    active_api_keys=EXCLUDED.active_api_keys,active_environments=EXCLUDED.active_environments,
    active_users=EXCLUDED.active_users,active_members=EXCLUDED.active_members,
    alert_count=EXCLUDED.alert_count,connector_deliveries=EXCLUDED.connector_deliveries,
    failed_notifications=EXCLUDED.failed_notifications,rate_limit_usage=EXCLUDED.rate_limit_usage,
    latency_ms_p50=EXCLUDED.latency_ms_p50,latency_ms_p75=EXCLUDED.latency_ms_p75,
    latency_ms_p90=EXCLUDED.latency_ms_p90,latency_ms_p95=EXCLUDED.latency_ms_p95,
    latency_ms_p99=EXCLUDED.latency_ms_p99,updated_at=NOW(),version=project_usage_daily.version+1;

  INSERT INTO project_usage_monthly(
    organization_id,project_id,bucket,total_events,total_bytes,api_key_requests,
    rate_limited_events,alert_notifications,active_users
  )
  SELECT organization_id,project_id,date_trunc('month',bucket)::date,SUM(total_events),SUM(total_bytes),
    SUM(requests),SUM(rate_limit_usage)::bigint,SUM(alert_count),MAX(active_users)
  FROM project_usage_daily
  GROUP BY organization_id,project_id,date_trunc('month',bucket)::date
  ON CONFLICT(project_id,bucket) DO UPDATE SET
    organization_id=EXCLUDED.organization_id,total_events=EXCLUDED.total_events,
    total_bytes=EXCLUDED.total_bytes,api_key_requests=EXCLUDED.api_key_requests,
    rate_limited_events=EXCLUDED.rate_limited_events,alert_notifications=EXCLUDED.alert_notifications,
    active_users=EXCLUDED.active_users,updated_at=NOW(),version=project_usage_monthly.version+1;

  INSERT INTO project_usage_current(
    project_id,organization_id,period_start,total_events,errors,requests,traces,logs,metrics,
    profiles,alert_count,connector_deliveries,failed_notifications
  )
  SELECT project_id,organization_id,date_trunc('month',CURRENT_DATE)::date,SUM(total_events),
    SUM(errors),SUM(requests),SUM(traces),SUM(logs),SUM(metrics),SUM(profiles),SUM(alert_count),
    SUM(connector_deliveries),SUM(failed_notifications)
  FROM project_usage_daily
  WHERE bucket>=date_trunc('month',CURRENT_DATE)
  GROUP BY project_id,organization_id
  ON CONFLICT(project_id) DO UPDATE SET
    organization_id=EXCLUDED.organization_id,period_start=EXCLUDED.period_start,
    total_events=EXCLUDED.total_events,errors=EXCLUDED.errors,requests=EXCLUDED.requests,
    traces=EXCLUDED.traces,logs=EXCLUDED.logs,metrics=EXCLUDED.metrics,profiles=EXCLUDED.profiles,
    alert_count=EXCLUDED.alert_count,connector_deliveries=EXCLUDED.connector_deliveries,
    failed_notifications=EXCLUDED.failed_notifications,updated_at=NOW(),
    version=project_usage_current.version+1;

  INSERT INTO api_key_usage_hourly(
    api_key_id,project_id,organization_id,environment_id,bucket,event_type,
    requests,events,errors,bytes_ingested,rate_limited,latency_ms_p50,latency_ms_p95,latency_ms_p99
  )
  SELECT api_key_id,project_id,organization_id,environment_id,date_trunc('hour',bucket),event_type,
    SUM(requests),SUM(events),SUM(errors),SUM(bytes_ingested),SUM(rate_limited),
    MAX(latency_ms_p50),MAX(latency_ms_p95),MAX(latency_ms_p99)
  FROM api_key_usage_minute
  GROUP BY api_key_id,project_id,organization_id,environment_id,date_trunc('hour',bucket),event_type
  ON CONFLICT(api_key_id,bucket,event_type) DO UPDATE SET
    project_id=EXCLUDED.project_id,organization_id=EXCLUDED.organization_id,
    environment_id=EXCLUDED.environment_id,requests=EXCLUDED.requests,events=EXCLUDED.events,
    errors=EXCLUDED.errors,bytes_ingested=EXCLUDED.bytes_ingested,rate_limited=EXCLUDED.rate_limited,
    latency_ms_p50=EXCLUDED.latency_ms_p50,latency_ms_p95=EXCLUDED.latency_ms_p95,
    latency_ms_p99=EXCLUDED.latency_ms_p99,updated_at=NOW(),version=api_key_usage_hourly.version+1;

  INSERT INTO api_key_usage_daily(
    api_key_id,project_id,organization_id,environment_id,bucket,event_type,
    requests,events,errors,bytes_ingested,rate_limited,latency_ms_p50,latency_ms_p95,latency_ms_p99
  )
  SELECT api_key_id,project_id,organization_id,environment_id,date_trunc('day',bucket)::date,event_type,
    SUM(requests),SUM(events),SUM(errors),SUM(bytes_ingested),SUM(rate_limited),
    MAX(latency_ms_p50),MAX(latency_ms_p95),MAX(latency_ms_p99)
  FROM api_key_usage_hourly
  GROUP BY api_key_id,project_id,organization_id,environment_id,date_trunc('day',bucket)::date,event_type
  ON CONFLICT(api_key_id,bucket,event_type) DO UPDATE SET
    project_id=EXCLUDED.project_id,organization_id=EXCLUDED.organization_id,
    environment_id=EXCLUDED.environment_id,requests=EXCLUDED.requests,events=EXCLUDED.events,
    errors=EXCLUDED.errors,bytes_ingested=EXCLUDED.bytes_ingested,rate_limited=EXCLUDED.rate_limited,
    latency_ms_p50=EXCLUDED.latency_ms_p50,latency_ms_p95=EXCLUDED.latency_ms_p95,
    latency_ms_p99=EXCLUDED.latency_ms_p99,updated_at=NOW(),version=api_key_usage_daily.version+1;

  INSERT INTO api_key_usage_monthly(
    api_key_id,project_id,organization_id,environment_id,bucket,event_type,
    requests,events,errors,bytes_ingested,rate_limited,latency_ms_p50,latency_ms_p95,latency_ms_p99
  )
  SELECT api_key_id,project_id,organization_id,environment_id,date_trunc('month',bucket)::date,event_type,
    SUM(requests),SUM(events),SUM(errors),SUM(bytes_ingested),SUM(rate_limited),
    MAX(latency_ms_p50),MAX(latency_ms_p95),MAX(latency_ms_p99)
  FROM api_key_usage_daily
  GROUP BY api_key_id,project_id,organization_id,environment_id,date_trunc('month',bucket)::date,event_type
  ON CONFLICT(api_key_id,bucket,event_type) DO UPDATE SET
    project_id=EXCLUDED.project_id,organization_id=EXCLUDED.organization_id,
    environment_id=EXCLUDED.environment_id,requests=EXCLUDED.requests,events=EXCLUDED.events,
    errors=EXCLUDED.errors,bytes_ingested=EXCLUDED.bytes_ingested,rate_limited=EXCLUDED.rate_limited,
    latency_ms_p50=EXCLUDED.latency_ms_p50,latency_ms_p95=EXCLUDED.latency_ms_p95,
    latency_ms_p99=EXCLUDED.latency_ms_p99,updated_at=NOW(),version=api_key_usage_monthly.version+1;
END; $$ LANGUAGE plpgsql;
COMMENT ON FUNCTION rollup_project_usage() IS
  'Idempotently rebuilds canonical project and API-key hourly, daily, monthly, and current usage from lower grains.';
COMMIT;


-- Platform email channels may resolve each active member's verified account email.
BEGIN;
ALTER TABLE project_alert_channels DROP CONSTRAINT IF EXISTS project_alert_channels_destination_check;
ALTER TABLE project_alert_channels ADD CONSTRAINT project_alert_channels_destination_check CHECK (
  length(btrim(channel_type)) > 0 AND length(btrim(name)) > 0
  AND (connector_id IS NOT NULL OR NULLIF(btrim(destination), '') IS NOT NULL OR lower(channel_type)='email')
  AND jsonb_typeof(destination_metadata)='object'
);
COMMIT;
