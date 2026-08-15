-- Source: canonical_migrations_draft/18_ai/012_enterprise_ai_runtime.up.sql
CREATE OR REPLACE FUNCTION ai_refund_credit(
  p_owner_id UUID,
  p_request_id TEXT,
  p_idempotency_key TEXT,
  p_ai_mode TEXT,
  p_amount BIGINT,
  p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  original_amount BIGINT;
  refunded_amount BIGINT;
  original_unlimited BOOLEAN;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Refund amount must be positive'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_request_id,0));

  IF EXISTS (
    SELECT 1 FROM credit_ledger
    WHERE owner_type='organization' AND owner_id=p_owner_id AND idempotency_key=p_idempotency_key
  ) THEN RETURN FALSE; END IF;

  SELECT amount,COALESCE((metadata->>'unlimited')::boolean,FALSE)
  INTO original_amount,original_unlimited
  FROM credit_ledger
  WHERE owner_type='organization' AND owner_id=p_owner_id
    AND request_id=p_request_id AND ai_mode=p_ai_mode
    AND direction='debit' AND status='completed'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF original_amount IS NULL THEN
    RAISE EXCEPTION 'No completed AI debit exists for this refund';
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO refunded_amount
  FROM credit_ledger
  WHERE owner_type='organization' AND owner_id=p_owner_id
    AND request_id=p_request_id AND ai_mode=p_ai_mode
    AND direction='refund' AND status='completed';

  IF p_amount > original_amount-refunded_amount THEN
    RAISE EXCEPTION 'Refund exceeds remaining refundable AI debit';
  END IF;

  IF NOT original_unlimited THEN
    UPDATE credit_balances
    SET balance=balance+p_amount,version=version+1
    WHERE owner_type='organization' AND owner_id=p_owner_id AND unlimited=FALSE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Refund credit balance is unavailable'; END IF;
  END IF;

  INSERT INTO credit_ledger
    (owner_type,owner_id,request_id,idempotency_key,ai_mode,amount,direction,reason,status,metadata)
  VALUES
    ('organization',p_owner_id,p_request_id,p_idempotency_key,p_ai_mode,p_amount,'refund',
     LEFT(COALESCE(p_reason,'AI credit refund'),500),'completed',
     jsonb_build_object('original_debit_amount',original_amount,'unlimited',original_unlimited));
  RETURN TRUE;
END;
$$;

-- Source: canonical_migrations_draft/18_ai/012_enterprise_ai_runtime.up.sql
CREATE OR REPLACE FUNCTION ai_release_stale_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item RECORD;
  released INTEGER := 0;
BEGIN
  PERFORM set_config('ai.allow_ledger_mutation','on',true);
  FOR item IN
    SELECT ledger_id,owner_id,amount,(metadata->>'unlimited')::boolean AS unlimited
    FROM credit_ledger
    WHERE direction='debit' AND status='pending' AND created_at < NOW()-INTERVAL '15 minutes'
    FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT COALESCE(item.unlimited,FALSE) THEN
      UPDATE credit_balances
      SET reserved_credits=GREATEST(0,reserved_credits-item.amount),version=version+1
      WHERE owner_type='organization' AND owner_id=item.owner_id;
    END IF;
    UPDATE credit_ledger SET status='failed',reason='Stale reservation automatically released'
    WHERE ledger_id=item.ledger_id;
    released := released+1;
  END LOOP;
  RETURN released;
END;
$$;

-- Source: migrations/003_project_module_refactor.sql
CREATE OR REPLACE FUNCTION bump_project_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = COALESCE(OLD.version, 1) + 1;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION consume_ai_credits(
    p_organization_id UUID,
    p_credits BIGINT
)
RETURNS VOID
LANGUAGE SQL
AS $$
UPDATE organization_usage_current_period
SET ai_credits_used = ai_credits_used + p_credits,
    last_ai_request_at = NOW(),
    updated_at = NOW()
WHERE organization_id = p_organization_id;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION create_event_partitions(p_days_ahead INTEGER DEFAULT 7)
RETURNS void AS $$
BEGIN
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION create_future_monthly_partitions(
    p_months_ahead INTEGER DEFAULT 2
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_month DATE;
    i INTEGER;
BEGIN
    FOR i IN 0..p_months_ahead LOOP

        v_month :=
            (date_trunc('month', CURRENT_DATE)
             + make_interval(months => i))::DATE;

        PERFORM create_monthly_partition(
            'connector_deliveries',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_delivery_attempts',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_health_checks',
            v_month
        );

        PERFORM create_monthly_partition(
            'connector_audit_logs',
            v_month
        );

    END LOOP;
END;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION create_monthly_partition(
    p_parent_table TEXT,
    p_partition_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_partition_name TEXT;
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    -- Normalize to first day of month
    v_start_date := date_trunc('month', p_partition_date)::DATE;
    v_end_date := (v_start_date + INTERVAL '1 month')::DATE;

    v_partition_name :=
        format(
            '%s_%s',
            p_parent_table,
            to_char(v_start_date, 'YYYY_MM')
        );

    EXECUTE format(
        '
        CREATE TABLE IF NOT EXISTS %I
        PARTITION OF %I
        FOR VALUES FROM (%L) TO (%L)
        ',
        v_partition_name,
        p_parent_table,
        v_start_date,
        v_end_date
    );

    RAISE NOTICE 'Partition % created.', v_partition_name;

EXCEPTION
WHEN OTHERS THEN
    RAISE EXCEPTION
        'Failed creating partition for table %, month %: %',
        p_parent_table,
        v_start_date,
        SQLERRM;
END;
$$;

-- Source: canonical_migrations_draft/18_ai/003_credit_ledger.up.sql
CREATE OR REPLACE FUNCTION credit_ledger_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('ai.allow_ledger_mutation', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'credit_ledger is append-only: % is not permitted', TG_OP;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/013_configure_project_integrity.up.sql
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
 value_id:=NULLIF(to_jsonb(NEW)->>'project_alert_channel_id','')::uuid;
 IF value_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM project_alert_channels WHERE id=value_id AND project_id=NEW.project_id AND organization_id=NEW.organization_id AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'alert channel tenant mismatch'; END IF;
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

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION flush_usage_counters()
RETURNS TABLE(flushed_project_id UUID, flushed_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    SELECT id, project_id, org_id, counter_type, increment_by, created_at
    FROM usage_counter_staging
    WHERE created_at < NOW() - INTERVAL '5 seconds'
    ORDER BY id
    LIMIT 10000
    FOR UPDATE SKIP LOCKED
  ),
  aggregated AS (
    SELECT
      project_id,
      org_id,
      counter_type,
      date_trunc('hour', created_at) AS period_start,
      date_trunc('hour', created_at) + INTERVAL '1 hour' AS period_end,
      SUM(increment_by) AS total_increment
    FROM batch
    GROUP BY project_id, org_id, counter_type, date_trunc('hour', created_at)
  ),
  upserted AS (
    INSERT INTO project_usage
      (project_id, org_id, counter_type, period_start, period_end, value, updated_at)
    SELECT project_id, org_id, counter_type, period_start, period_end, total_increment, NOW()
    FROM aggregated
    ON CONFLICT (project_id, counter_type, period_start)
    DO UPDATE SET value = project_usage.value + EXCLUDED.value, updated_at = NOW()
    RETURNING project_id
  ),
  deleted AS (
    DELETE FROM usage_counter_staging s
    USING batch b
    WHERE s.id = b.id
    RETURNING s.id, s.project_id
  )
  SELECT d.project_id, COUNT(*)::BIGINT
  FROM deleted d
  GROUP BY d.project_id;
END;
$$ LANGUAGE plpgsql;

-- Source: canonical_migrations_draft/04_projects/022_add_project_public_id.sql
CREATE OR REPLACE FUNCTION fn_prevent_project_public_id_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.public_id IS DISTINCT FROM NEW.public_id THEN
    RAISE EXCEPTION
      'projects.public_id is immutable. Attempted change from "%" to "%".',
      OLD.public_id, NEW.public_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION generate_backup_codes_for_user(
  p_user_id UUID,
  p_count INTEGER DEFAULT 10
) RETURNS TABLE(code_plaintext TEXT, code_hash TEXT) AS $$
DECLARE
  v_code TEXT;
  v_hash TEXT;
BEGIN
  -- Generate N random backup codes and their hashes
  FOR i IN 1..p_count LOOP
    v_code := upper(encode(gen_random_bytes(10), 'hex'));
    v_hash := crypt(v_code, gen_salt('bf', 12));
    
    INSERT INTO user_backup_codes (user_id, code_hash)
    VALUES (p_user_id, v_hash);
    
    code_plaintext := v_code;
    code_hash := v_hash;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION get_effective_integer_feature(
    p_organization_id UUID,
    p_feature_key TEXT
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT integer_value
FROM v_effective_entitlements
WHERE organization_id = p_organization_id
  AND feature_key = p_feature_key
LIMIT 1;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION has_feature(
    p_organization_id UUID,
    p_feature_key TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
SELECT COALESCE(boolean_value,FALSE)
FROM v_effective_entitlements
WHERE organization_id = p_organization_id
  AND feature_key = p_feature_key
LIMIT 1;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION increment_event_usage(
    p_organization_id UUID,
    p_count BIGINT DEFAULT 1
)
RETURNS VOID
LANGUAGE SQL
AS $$
UPDATE organization_usage_current_period
SET events_used = events_used + p_count,
    last_event_at = NOW(),
    updated_at = NOW()
WHERE organization_id = p_organization_id;
$$;

-- Source: canonical_migrations_draft/04_projects/020_remove_sdk_config_provisioning_trigger.up.sql
-- Environment SDK config is provisioned explicitly in application-level transactions (SdkConfigProvisioner).

-- Source: canonical_migrations_draft/04_projects/021_remove_project_defaults_provisioning_trigger.up.sql
-- Project defaults are provisioned explicitly in application-level transactions (ProjectService.createProject).


-- Source: canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql
CREATE OR REPLACE FUNCTION pulse_build_sdk_config(
  p_project_id uuid,
  p_environment text,
  p_generated_at text,
  p_intent jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  base_url text := regexp_replace(COALESCE(NULLIF(current_setting('pulse.backend_url',true),''),'http://localhost:5000/api'),'/*$','');
  mandatory_headers jsonb := '["authorization","proxy-authorization","cookie","set-cookie","x-api-key"]'::jsonb;
  mandatory_fields jsonb := '["password","secret","token","apiKey","authorization","creditCard","ssn","access_token","refresh_token","client_secret"]'::jsonb;
  config jsonb;
  hash text;
BEGIN
  config := jsonb_build_object(
    'schemaVersion',1,
    'sdk',jsonb_build_object('projectId',p_project_id::text,'environment',p_environment,'release','1.0.0'),
    'features',jsonb_build_object(
      'tracing',true,'requestCapture',true,'errors',true,'metrics',true,'logging',true,
      'profiling',false,'crons',false,'sessionReplay',false,'runtimeMetrics',false,
      'eventLoopMonitoring',false,'gcMonitoring',false),
    'sampling',pulse_sdk_sampling_v2('{}'::jsonb),
    'instrumentation',jsonb_build_object(
      'http',true,'https',true,'fetch',true,'axios',false,'fastify',true,'express',true,
      'graphql',false,'prisma',false,'mongodb',false,'redis',false,'bullmq',false,
      'pg',false,'mysql2',false,'eventEmitterPatch',true),
    'privacy',jsonb_build_object(
      'capture',jsonb_build_object('headers',false,'body',false,'response',false,'query',false,'cookies',false),
      'scrubbing',jsonb_build_object('enabled',true,'headers',mandatory_headers,'fields',mandatory_fields),
      'piiDetection',jsonb_build_object('enabled',true,'maskEmails',true,'maskPhones',true,'maskIPs',true)),
    'limits',jsonb_build_object(
      'maxSpansPerTrace',2000,'maxSpanAttributes',128,'maxAttributeLength',4096,
      'maxPayloadSize',1048576,'maxQueueSize',10000,'maxMemoryMb','auto',
      'tenantGovernance',jsonb_build_object('enabled',false,'maxTenantsTracked',1000,
        'quotaPerWindow',10000,'windowDurationMs',60000,'criticalReserve',100)),
    'killswitches',jsonb_build_object(
      'disableSDK',false,'disableTracing',false,'disableMetrics',false,'disableTransport',false,
      'disableProfiling',false,'disableErrors',false,'disableLogs',false),
    'transport',jsonb_build_object(
      'retry',jsonb_build_object('enabled',true,'maxRetries',3,'backoff','exponential','baseDelayMs',500),
      'queue',jsonb_build_object('overflowStrategy','drop_oldest','maxSize',10000,'criticalReserve',1000),
      'connections',jsonb_build_object('maxTotalConnections',50,'acquireTimeoutMs',5000),
      'keepAlive',true,
      'routes',jsonb_build_object(
        'errors',jsonb_build_object('url',base_url||'/v1/errors','batchSize',100,'flushIntervalMs',1000,'timeoutMs',5000,'compression','gzip','priority','critical'),
        'events',jsonb_build_object('url',base_url||'/v1/events','batchSize',100,'flushIntervalMs',2000,'timeoutMs',5000,'compression','gzip','priority','high'),
        'traces',jsonb_build_object('url',base_url||'/v1/traces','batchSize',500,'flushIntervalMs',5000,'timeoutMs',5000,'compression','gzip','priority','high'),
        'spans',jsonb_build_object('url',base_url||'/v1/spans','batchSize',500,'flushIntervalMs',5000,'timeoutMs',5000,'compression','gzip','priority','normal'),
        'requests',jsonb_build_object('url',base_url||'/v1/requests','batchSize',500,'flushIntervalMs',5000,'timeoutMs',5000,'compression','gzip','priority','high'),
        'metrics',jsonb_build_object('url',base_url||'/v1/metrics','batchSize',1000,'flushIntervalMs',10000,'timeoutMs',5000,'compression','gzip','priority','normal'),
        'logs',jsonb_build_object('url',base_url||'/v1/logs','batchSize',200,'flushIntervalMs',10000,'timeoutMs',5000,'compression','gzip','priority','normal'),
        'profiles',jsonb_build_object('url',base_url||'/v1/profiles','batchSize',5,'flushIntervalMs',30000,'timeoutMs',15000,'compression','gzip','priority','low'),
        'crons',jsonb_build_object('url',base_url||'/v1/checkins','batchSize',1,'flushIntervalMs',0,'timeoutMs',5000,'compression','none','priority','high'),
        'replays',jsonb_build_object('url',base_url||'/v1/replays','batchSize',5,'flushIntervalMs',10000,'timeoutMs',30000,'compression','gzip','priority','low'))),
    'runtime',jsonb_build_object('configTtlSeconds',300,'staleWhileRevalidate',true),
    'meta',jsonb_build_object('generatedAt',p_generated_at,'generatedBy','pulse-config-compiler@1','configHash',''),
    'entitlements',jsonb_build_object(
      'customSpans',true,'customMetrics',true,'profiling',false,'logging',true,'sessionReplay',false,
      'crons',false,'requestCapture',true,'tracing',true,'errors',true,'metrics',true)
  );
  config := pulse_jsonb_deep_merge(config,pulse_extract_sdk_intent(p_intent));
  config := jsonb_set(config,'{sampling}',pulse_sdk_sampling_v2(config->'sampling'),true);
  config := jsonb_set(config,'{privacy,scrubbing,headers}',pulse_jsonb_dedupe_strings(mandatory_headers,config #> '{privacy,scrubbing,headers}'),true);
  config := jsonb_set(config,'{privacy,scrubbing,fields}',pulse_jsonb_dedupe_strings(mandatory_fields,config #> '{privacy,scrubbing,fields}'),true);
  config := jsonb_set(config,'{schemaVersion}','1'::jsonb,true);
  config := jsonb_set(config,'{sdk}',jsonb_build_object('projectId',p_project_id::text,'environment',p_environment,'release','1.0.0'),true);
  config := jsonb_set(config,'{meta}',jsonb_build_object('generatedAt',p_generated_at,'generatedBy','pulse-config-compiler@1','configHash',''),true);
  config := jsonb_set(config,'{entitlements}',jsonb_build_object(
    'customSpans',true,'customMetrics',true,'profiling',false,'logging',true,'sessionReplay',false,
    'crons',false,'requestCapture',true,'tracing',true,'errors',true,'metrics',true),true);
  config := jsonb_set(config,'{transport,routes,errors,url}',to_jsonb(base_url||'/v1/errors'),true);
  config := jsonb_set(config,'{transport,routes,events,url}',to_jsonb(base_url||'/v1/events'),true);
  config := jsonb_set(config,'{transport,routes,traces,url}',to_jsonb(base_url||'/v1/traces'),true);
  config := jsonb_set(config,'{transport,routes,spans,url}',to_jsonb(base_url||'/v1/spans'),true);
  config := jsonb_set(config,'{transport,routes,requests,url}',to_jsonb(base_url||'/v1/requests'),true);
  config := jsonb_set(config,'{transport,routes,metrics,url}',to_jsonb(base_url||'/v1/metrics'),true);
  config := jsonb_set(config,'{transport,routes,logs,url}',to_jsonb(base_url||'/v1/logs'),true);
  config := jsonb_set(config,'{transport,routes,profiles,url}',to_jsonb(base_url||'/v1/profiles'),true);
  config := jsonb_set(config,'{transport,routes,crons,url}',to_jsonb(base_url||'/v1/checkins'),true);
  config := jsonb_set(config,'{transport,routes,replays,url}',to_jsonb(base_url||'/v1/replays'),true);
  hash := pulse_sdk_hash(config);
  RETURN jsonb_set(config,'{meta,configHash}',to_jsonb(hash),true);
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_canonical_jsonb(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE v_type text := jsonb_typeof(p_value); v_text text;
BEGIN
  CASE v_type
    WHEN 'object' THEN
      SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||pulse_canonical_jsonb(value),',' ORDER BY pulse_utf16_sort_key(key)),'')||'}'
        INTO v_text FROM jsonb_each(p_value);
      RETURN v_text;
    WHEN 'array' THEN
      SELECT '['||COALESCE(string_agg(pulse_canonical_jsonb(value),',' ORDER BY ordinality),'')||']'
        INTO v_text FROM jsonb_array_elements(p_value) WITH ORDINALITY;
      RETURN v_text;
    WHEN 'number' THEN
      RETURN pulse_canonical_number(p_value);
    ELSE RETURN p_value::text;
  END CASE;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_canonical_number(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  v_text text := p_value #>> '{}';
  v_sign text := '';
  v_fraction text;
  v_digits text;
  v_first integer;
  v_mantissa text;
BEGIN
  IF position('.' in v_text)>0 THEN
    v_text := regexp_replace(regexp_replace(v_text,'0+$',''),'\.$','');
  END IF;
  IF v_text='-0' THEN RETURN '0'; END IF;

  -- JSON.stringify uses scientific notation below 1e-6. SDK numbers are
  -- bounded below 1e21, so this is the only exponent threshold reachable by
  -- the schema-v1 contract.
  IF v_text ~ '^-?0\.0{6,}[1-9][0-9]*$' THEN
    IF left(v_text,1)='-' THEN
      v_sign := '-';
      v_text := substr(v_text,2);
    END IF;
    v_fraction := split_part(v_text,'.',2);
    v_first := length(v_fraction)-length(ltrim(v_fraction,'0'))+1;
    v_digits := ltrim(v_fraction,'0');
    v_mantissa := left(v_digits,1);
    IF length(v_digits)>1 THEN
      v_mantissa := v_mantissa||'.'||substr(v_digits,2);
    END IF;
    RETURN v_sign||v_mantissa||'e-'||v_first::text;
  END IF;
  RETURN v_text;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql
CREATE OR REPLACE FUNCTION pulse_extract_sdk_intent(p_source jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s jsonb := CASE WHEN jsonb_typeof(p_source)='object' THEN p_source ELSE '{}'::jsonb END;
  result jsonb := '{}'::jsonb;
  inst jsonb := '{}'::jsonb;
  routes jsonb := '{}'::jsonb;
  pii jsonb;
  conn jsonb;
  v jsonb;
  k text;
BEGIN
  result := jsonb_set(result,'{features}',pulse_jsonb_pick_keys(s->'features',ARRAY[
    'tracing','requestCapture','errors','metrics','logging','profiling','crons','sessionReplay',
    'runtimeMetrics','eventLoopMonitoring','gcMonitoring']),true);

  v := pulse_jsonb_pick_keys(s->'sampling',ARRAY[
    'errors','traces','spans','requests','metrics','logs','events','messages','profiles','replays','crons','routes'
  ]);
  IF jsonb_typeof(v->'routes')<>'object' THEN v := v-'routes'; END IF;
  result := jsonb_set(result,'{sampling}',v,true);

  FOREACH k IN ARRAY ARRAY['http','https','fetch','axios','fastify','express','graphql','prisma','mongodb','redis','bullmq','pg','mysql2','eventEmitterPatch'] LOOP
    v := s #> ARRAY['instrumentation',k];
    IF jsonb_typeof(v)='object' THEN v := v->'enabled'; END IF;
    IF jsonb_typeof(v)='boolean' THEN inst := jsonb_set(inst,ARRAY[k],v,true); END IF;
  END LOOP;
  result := jsonb_set(result,'{instrumentation}',inst,true);

  pii := COALESCE(s #> '{privacy,piiDetection}',s #> '{privacy,pii}','{}'::jsonb);
  v := jsonb_strip_nulls(jsonb_build_object(
    'enabled',pulse_sdk_scalar(pii,ARRAY['enabled'],'boolean'),
    'maskEmails',pulse_sdk_scalar(pii,ARRAY['maskEmails'],'boolean'),
    'maskPhones',COALESCE(pulse_sdk_scalar(pii,ARRAY['maskPhones'],'boolean'),pulse_sdk_scalar(pii,ARRAY['maskPhoneNumbers'],'boolean')),
    'maskIPs',pulse_sdk_scalar(pii,ARRAY['maskIPs'],'boolean')
  ));
  result := jsonb_set(result,'{privacy}',jsonb_build_object(
    'capture',pulse_jsonb_pick_keys(s #> '{privacy,capture}',ARRAY['headers','body','response','query','cookies']),
    'scrubbing',pulse_jsonb_pick_keys(s #> '{privacy,scrubbing}',ARRAY['enabled','headers','fields']),
    'piiDetection',v
  ),true);

  v := pulse_jsonb_pick_keys(s->'limits',ARRAY[
    'maxSpansPerTrace','maxSpanAttributes','maxAttributeLength','maxPayloadSize','maxQueueSize',
    'maxMemoryMb','tenantGovernance']);
  IF jsonb_typeof(v->'tenantGovernance')='object' THEN
    v := jsonb_set(v,'{tenantGovernance}',pulse_jsonb_pick_keys(v->'tenantGovernance',ARRAY[
      'enabled','maxTenantsTracked','quotaPerWindow','windowDurationMs','criticalReserve']),true);
  ELSE v := v-'tenantGovernance'; END IF;
  result := jsonb_set(result,'{limits}',v,true);

  result := jsonb_set(result,'{killswitches}',pulse_jsonb_pick_keys(s->'killswitches',ARRAY[
    'disableSDK','disableTracing','disableMetrics','disableTransport','disableProfiling','disableErrors','disableLogs']),true);

  conn := pulse_jsonb_pick_keys(s #> '{transport,connections}',ARRAY['maxTotalConnections','acquireTimeoutMs']);
  IF NOT (conn?'maxTotalConnections') AND jsonb_typeof(s #> '{transport,connections,total}')='number' THEN
    conn := jsonb_set(conn,'{maxTotalConnections}',s #> '{transport,connections,total}',true);
  END IF;
  IF jsonb_typeof(s #> '{transport,routes}')='object' THEN
    FOREACH k IN ARRAY ARRAY['errors','events','traces','spans','requests','metrics','logs','profiles','crons','replays'] LOOP
      v := pulse_jsonb_pick_keys(s #> ARRAY['transport','routes',k],ARRAY['batchSize','flushIntervalMs','timeoutMs','compression','priority']);
      IF v<>'{}'::jsonb THEN routes := jsonb_set(routes,ARRAY[k],v,true); END IF;
    END LOOP;
  END IF;
  result := jsonb_set(result,'{transport}',jsonb_strip_nulls(jsonb_build_object(
    'retry',pulse_jsonb_pick_keys(s #> '{transport,retry}',ARRAY['enabled','maxRetries','backoff','baseDelayMs']),
    'queue',pulse_jsonb_pick_keys(s #> '{transport,queue}',ARRAY['overflowStrategy','maxSize','criticalReserve']),
    'connections',conn,
    'keepAlive',pulse_sdk_scalar(s,ARRAY['transport','keepAlive'],'boolean'),
    'routes',routes
  )),true);
  result := jsonb_set(result,'{runtime}',pulse_jsonb_pick_keys(s->'runtime',ARRAY['configTtlSeconds','staleWhileRevalidate']),true);
  RETURN result;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_exact_keys(p_value jsonb, p_keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_value)='object'
     AND (SELECT count(*) FROM jsonb_object_keys(p_value))=cardinality(p_keys)
     AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE NOT (k=ANY(p_keys)));
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_all_booleans(p_value jsonb, p_keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT pulse_jsonb_exact_keys(p_value,p_keys)
     AND NOT EXISTS (SELECT 1 FROM unnest(p_keys) k WHERE jsonb_typeof(p_value->k)<>'boolean');
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_dedupe_strings(p_first jsonb, p_second jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb := '[]'::jsonb; seen text[] := ARRAY[]::text[]; v text;
BEGIN
  FOR v IN SELECT value FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(p_first)='array' THEN p_first ELSE '[]'::jsonb END ||
    CASE WHEN jsonb_typeof(p_second)='array' THEN p_second ELSE '[]'::jsonb END
  ) LOOP
    IF NOT (v=ANY(seen)) THEN seen := array_append(seen,v); result := result||to_jsonb(v); END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_deep_merge(p_base jsonb, p_overlay jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb := COALESCE(p_base,'{}'::jsonb); item record;
BEGIN
  IF jsonb_typeof(p_overlay)<>'object' THEN RETURN p_overlay; END IF;
  IF jsonb_typeof(result)<>'object' THEN result := '{}'::jsonb; END IF;
  FOR item IN SELECT key,value FROM jsonb_each(p_overlay) LOOP
    IF jsonb_typeof(result->item.key)='object' AND jsonb_typeof(item.value)='object' THEN
      result := jsonb_set(result,ARRAY[item.key],pulse_jsonb_deep_merge(result->item.key,item.value),true);
    ELSE
      result := jsonb_set(result,ARRAY[item.key],item.value,true);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_number_between(
  p_value jsonb, p_min numeric, p_max numeric, p_integer boolean DEFAULT true
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v numeric;
BEGIN
  IF jsonb_typeof(p_value)<>'number' THEN RETURN false; END IF;
  v := (p_value #>> '{}')::numeric;
  RETURN v BETWEEN p_min AND p_max AND (NOT p_integer OR v=trunc(v));
EXCEPTION WHEN others THEN RETURN false;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_pick_keys(p_value jsonb, p_keys text[])
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p_value)='object' THEN
    COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(p_value) WHERE key=ANY(p_keys)),'{}'::jsonb)
  ELSE '{}'::jsonb END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_jsonb_string_array(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v jsonb;
BEGIN
  IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)>500 THEN RETURN false; END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF jsonb_typeof(v)<>'string' OR octet_length(v #>> '{}') NOT BETWEEN 1 AND 512 THEN RETURN false; END IF;
  END LOOP;
  RETURN (SELECT count(*)=count(DISTINCT value) FROM jsonb_array_elements_text(p_value));
END;
$$;

-- Source: canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql
CREATE OR REPLACE FUNCTION pulse_sdk_config_valid(c jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v jsonb; path text; n numeric;
BEGIN
  IF NOT pulse_jsonb_exact_keys(c,ARRAY['schemaVersion','sdk','features','sampling','instrumentation','privacy','limits','killswitches','transport','runtime','meta','entitlements']) THEN RETURN false; END IF;
  IF c->>'schemaVersion'<>'1' THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'sdk',ARRAY['projectId','environment','release'])
     OR COALESCE(c#>>'{sdk,projectId}','')='' OR octet_length(c#>>'{sdk,projectId}')>128
     OR COALESCE(c#>>'{sdk,environment}','')='' OR octet_length(c#>>'{sdk,environment}')>64
     OR COALESCE(c#>>'{sdk,release}','')='' OR octet_length(c#>>'{sdk,release}')>100 THEN RETURN false; END IF;
  IF NOT pulse_jsonb_all_booleans(c->'features',ARRAY['tracing','requestCapture','errors','metrics','logging','profiling','crons','sessionReplay','runtimeMetrics','eventLoopMonitoring','gcMonitoring']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'sampling',ARRAY['errors','traces','spans','requests','metrics','logs','events','messages','profiles','replays','crons','routes']) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['errors','traces','spans','requests','metrics','logs','events','messages','profiles','replays','crons'] LOOP
    IF NOT pulse_jsonb_number_between(c#>ARRAY['sampling',k],0,1,false) THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(c#>'{sampling,routes}')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(c#>'{sampling,routes}'))>1000 THEN RETURN false; END IF;
  FOR k,v IN SELECT key,value FROM jsonb_each(c#>'{sampling,routes}') LOOP
    IF left(k,1)<>'/' OR octet_length(k)>512 OR jsonb_typeof(v)<>'object' OR v='{}'::jsonb THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v) x WHERE NOT (x=ANY(ARRAY['errors','traces','spans','requests','metrics','logs','events','messages','profiles','replays','crons']))) THEN RETURN false; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(v) x WHERE NOT pulse_jsonb_number_between(x.value,0,1,false)) THEN RETURN false; END IF;
  END LOOP;
  IF NOT pulse_jsonb_all_booleans(c->'instrumentation',ARRAY['http','https','fetch','axios','fastify','express','graphql','prisma','mongodb','redis','bullmq','pg','mysql2','eventEmitterPatch']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'privacy',ARRAY['capture','scrubbing','piiDetection'])
     OR NOT pulse_jsonb_all_booleans(c#>'{privacy,capture}',ARRAY['headers','body','response','query','cookies'])
     OR NOT pulse_jsonb_exact_keys(c#>'{privacy,scrubbing}',ARRAY['enabled','headers','fields'])
     OR jsonb_typeof(c#>'{privacy,scrubbing,enabled}')<>'boolean'
     OR NOT pulse_jsonb_string_array(c#>'{privacy,scrubbing,headers}')
     OR NOT pulse_jsonb_string_array(c#>'{privacy,scrubbing,fields}')
     OR NOT pulse_jsonb_all_booleans(c#>'{privacy,piiDetection}',ARRAY['enabled','maskEmails','maskPhones','maskIPs']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'limits',ARRAY['maxSpansPerTrace','maxSpanAttributes','maxAttributeLength','maxPayloadSize','maxQueueSize','maxMemoryMb','tenantGovernance']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_number_between(c#>'{limits,maxSpansPerTrace}',1,100000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxSpanAttributes}',1,1000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxAttributeLength}',1,65536,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxPayloadSize}',1024,10485760,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxQueueSize}',100,1000000,true) THEN RETURN false; END IF;
  IF NOT ((c#>'{limits,maxMemoryMb}')='"auto"'::jsonb OR pulse_jsonb_number_between(c#>'{limits,maxMemoryMb}',64,1048576,true)) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c#>'{limits,tenantGovernance}',ARRAY['enabled','maxTenantsTracked','quotaPerWindow','windowDurationMs','criticalReserve'])
     OR jsonb_typeof(c#>'{limits,tenantGovernance,enabled}')<>'boolean'
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,maxTenantsTracked}',1,1000000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,quotaPerWindow}',1,100000000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,windowDurationMs}',1000,86400000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,criticalReserve}',0,1000000,true) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_all_booleans(c->'killswitches',ARRAY['disableSDK','disableTracing','disableMetrics','disableTransport','disableProfiling','disableErrors','disableLogs']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'runtime',ARRAY['configTtlSeconds','staleWhileRevalidate'])
     OR NOT pulse_jsonb_number_between(c#>'{runtime,configTtlSeconds}',30,86400,true)
     OR jsonb_typeof(c#>'{runtime,staleWhileRevalidate}')<>'boolean' THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'meta',ARRAY['generatedAt','generatedBy','configHash'])
     OR COALESCE(c#>>'{meta,generatedAt}','')=''
     OR c#>>'{meta,generatedBy}'<>'pulse-config-compiler@1'
     OR COALESCE(c#>>'{meta,configHash}','') !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  IF NOT pulse_jsonb_all_booleans(c->'entitlements',ARRAY['customSpans','customMetrics','profiling','logging','sessionReplay','crons','requestCapture','tracing','errors','metrics']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'transport',ARRAY['retry','queue','connections','keepAlive','routes'])
     OR jsonb_typeof(c#>'{transport,keepAlive}')<>'boolean'
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,retry}',ARRAY['enabled','maxRetries','backoff','baseDelayMs'])
     OR jsonb_typeof(c#>'{transport,retry,enabled}')<>'boolean'
     OR NOT pulse_jsonb_number_between(c#>'{transport,retry,maxRetries}',0,10,true)
     OR NOT (c#>>'{transport,retry,backoff}'=ANY(ARRAY['exponential','linear','fixed']))
     OR NOT pulse_jsonb_number_between(c#>'{transport,retry,baseDelayMs}',10,60000,true)
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,queue}',ARRAY['overflowStrategy','maxSize','criticalReserve'])
     OR NOT (c#>>'{transport,queue,overflowStrategy}'=ANY(ARRAY['drop_oldest','drop_newest','reject']))
     OR NOT pulse_jsonb_number_between(c#>'{transport,queue,maxSize}',100,1000000,true)
     OR NOT pulse_jsonb_number_between(c#>'{transport,queue,criticalReserve}',0,100000,true)
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,connections}',ARRAY['maxTotalConnections','acquireTimeoutMs'])
     OR NOT pulse_jsonb_number_between(c#>'{transport,connections,maxTotalConnections}',1,10000,true)
     OR NOT pulse_jsonb_number_between(c#>'{transport,connections,acquireTimeoutMs}',100,60000,true)
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,routes}',ARRAY['errors','events','traces','spans','requests','metrics','logs','profiles','crons','replays']) THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['errors','events','traces','spans','requests','metrics','logs','profiles','crons','replays'] LOOP
    v := c#>ARRAY['transport','routes',k];
    IF NOT pulse_jsonb_exact_keys(v,ARRAY['url','batchSize','flushIntervalMs','timeoutMs','compression','priority'])
       OR COALESCE(v->>'url','') !~ '^https?://'
       OR NOT pulse_jsonb_number_between(v->'batchSize',1,10000,true)
       OR NOT pulse_jsonb_number_between(v->'flushIntervalMs',0,300000,true)
       OR NOT pulse_jsonb_number_between(v->'timeoutMs',100,300000,true)
       OR NOT (v->>'compression'=ANY(ARRAY['gzip','none']))
       OR NOT (v->>'priority'=ANY(ARRAY['critical','high','normal','low'])) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_sdk_hash(p_config jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT encode(digest(
    pulse_canonical_jsonb(jsonb_set(p_config,'{meta}',COALESCE(p_config->'meta','{}'::jsonb)-'configHash')),
    'sha256'
  ),'hex');
$$;

-- Source: canonical_migrations_draft/04_projects/026_extend_sdk_sampling_contract.up.sql
CREATE OR REPLACE FUNCTION pulse_sdk_sampling_v2(sampling jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'errors', COALESCE(sampling->'errors', '1'::jsonb),
    'traces', COALESCE(sampling->'traces', '1'::jsonb),
    'spans', COALESCE(sampling->'spans', '1'::jsonb),
    'requests', COALESCE(sampling->'requests', '1'::jsonb),
    'metrics', COALESCE(sampling->'metrics', '1'::jsonb),
    'logs', COALESCE(sampling->'logs', '1'::jsonb),
    'events', COALESCE(sampling->'events', '1'::jsonb),
    'messages', COALESCE(sampling->'messages', '1'::jsonb),
    'profiles', COALESCE(sampling->'profiles', '0.1'::jsonb),
    'replays', COALESCE(sampling->'replays', '0.1'::jsonb),
    'crons', COALESCE(sampling->'crons', '1'::jsonb),
    'routes',
      COALESCE(
        CASE
          WHEN jsonb_typeof(sampling->'routes') = 'object'
          THEN jsonb_set(
            sampling->'routes',
            '{/health}',
            COALESCE(sampling #> '{routes,/health}', '{}'::jsonb)
              || jsonb_build_object('requests',0,'traces',0,'spans',0,'metrics',0,'logs',0),
            true
          )
          ELSE NULL
        END,
        jsonb_build_object(
          '/health', jsonb_build_object('requests',0,'traces',0,'spans',0,'metrics',0,'logs',0)
        )
      )
  )
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_sdk_scalar(p_source jsonb, p_path text[], p_type text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v jsonb := p_source #> p_path;
BEGIN
  IF v IS NOT NULL AND jsonb_typeof(v)=p_type THEN RETURN v; END IF;
  RETURN NULL;
END;
$$;

-- Source: canonical_migrations_draft/04_projects/025_upgrade_sdk_contract_v1.up.sql
CREATE OR REPLACE FUNCTION pulse_utf16_sort_key(p_value text)
RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  result bytea := ''::bytea;
  i integer;
  cp integer;
  adjusted integer;
  high_unit integer;
  low_unit integer;
BEGIN
  FOR i IN 1..char_length(p_value) LOOP
    cp := ascii(substr(p_value,i,1));
    IF cp <= 65535 THEN
      result := result || decode(lpad(to_hex(cp),4,'0'),'hex');
    ELSE
      adjusted := cp-65536;
      high_unit := 55296+(adjusted >> 10);
      low_unit := 56320+(adjusted & 1023);
      result := result
        || decode(lpad(to_hex(high_unit),4,'0'),'hex')
        || decode(lpad(to_hex(low_unit),4,'0'),'hex');
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION refresh_hourly_rollup(
  p_org_id UUID, p_start_hour TIMESTAMPTZ, p_end_hour TIMESTAMPTZ
) RETURNS void AS $$
BEGIN
  INSERT INTO analytics_hourly_rollup (
    organization_id, project_id, bucket_hour,
    error_count, error_fatal_count, error_error_count, error_warning_count,
    error_info_count, error_debug_count
  )
  SELECT
    organization_id, project_id, DATE_TRUNC('hour', timestamp) AS bucket_hour,
    COUNT(*),
    COUNT(*) FILTER (WHERE severity = 'fatal'),
    COUNT(*) FILTER (WHERE severity = 'error'),
    COUNT(*) FILTER (WHERE severity = 'warning'),
    COUNT(*) FILTER (WHERE severity = 'info'),
    COUNT(*) FILTER (WHERE severity = 'debug')
  FROM events_errors
  WHERE organization_id = p_org_id AND timestamp >= p_start_hour AND timestamp < p_end_hour
  GROUP BY organization_id, project_id, DATE_TRUNC('hour', timestamp)
  ON CONFLICT (organization_id, project_id, bucket_hour) DO UPDATE SET
    error_count = EXCLUDED.error_count,
    error_fatal_count = EXCLUDED.error_fatal_count,
    error_error_count = EXCLUDED.error_error_count,
    error_warning_count = EXCLUDED.error_warning_count,
    error_info_count = EXCLUDED.error_info_count,
    error_debug_count = EXCLUDED.error_debug_count,
    updated_at = NOW();

  INSERT INTO analytics_hourly_rollup (
    organization_id, project_id, bucket_hour,
    request_count, request_2xx_count, request_3xx_count, request_4xx_count, request_5xx_count,
    request_avg_latency_ms, request_p95_latency_ms, request_p99_latency_ms, unique_user_count
  )
  SELECT
    organization_id, project_id, DATE_TRUNC('hour', timestamp) AS bucket_hour,
    COUNT(*),
    COUNT(*) FILTER (WHERE status_code BETWEEN 200 AND 299),
    COUNT(*) FILTER (WHERE status_code BETWEEN 300 AND 399),
    COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499),
    COUNT(*) FILTER (WHERE status_code >= 500),
    AVG(latency_ms)::INTEGER,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::INTEGER,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::INTEGER,
    COUNT(DISTINCT user_id)
  FROM events_requests
  WHERE organization_id = p_org_id AND timestamp >= p_start_hour AND timestamp < p_end_hour
  GROUP BY organization_id, project_id, DATE_TRUNC('hour', timestamp)
  ON CONFLICT (organization_id, project_id, bucket_hour) DO UPDATE SET
    request_count = EXCLUDED.request_count,
    request_2xx_count = EXCLUDED.request_2xx_count,
    request_3xx_count = EXCLUDED.request_3xx_count,
    request_4xx_count = EXCLUDED.request_4xx_count,
    request_5xx_count = EXCLUDED.request_5xx_count,
    request_avg_latency_ms = EXCLUDED.request_avg_latency_ms,
    request_p95_latency_ms = EXCLUDED.request_p95_latency_ms,
    request_p99_latency_ms = EXCLUDED.request_p99_latency_ms,
    unique_user_count = EXCLUDED.unique_user_count,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Source: canonical_migrations_draft/04_projects/015_create_environment_sdk_configuration.up.sql
CREATE OR REPLACE FUNCTION reject_sdk_config_revision_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SDK configuration revisions are immutable' USING ERRCODE='55000';
END; $$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION remaining_ai_credits(
    p_organization_id UUID
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT GREATEST(ai_credit_limit - ai_credits_used,0)
FROM organization_usage_current_period
WHERE organization_id = p_organization_id;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION remaining_event_quota(
    p_organization_id UUID
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
SELECT GREATEST(event_limit - events_used,0)
FROM organization_usage_current_period
WHERE organization_id = p_organization_id;
$$;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION revoke_and_regenerate_backup_codes()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when a device becomes newly verified
  IF NEW.is_verified = TRUE AND (OLD.is_verified = FALSE OR OLD.is_verified IS NULL) THEN
    -- Revoke all existing unused backup codes
    DELETE FROM user_backup_codes
    WHERE user_id = NEW.user_id AND used_at IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Source: canonical_migrations_draft/19_automation/003_automation_workflow_versions.sql
CREATE OR REPLACE FUNCTION trg_fn_immutable_published_version() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'Cannot update an already-published workflow version (id=%)', OLD.id
      USING ERRCODE = '25000'; -- invalid_transaction_state
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Source: migrations/002_create_all.sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
