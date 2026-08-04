BEGIN;

-- Breaking SDK contract v1 upgrade.
-- Final state: one requested intent, one compiled snapshot, one compiler contract.

CREATE OR REPLACE FUNCTION pulse_jsonb_exact_keys(p_value jsonb, p_keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p_value)='object'
     AND (SELECT count(*) FROM jsonb_object_keys(p_value))=cardinality(p_keys)
     AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE NOT (k=ANY(p_keys)));
$$;

CREATE OR REPLACE FUNCTION pulse_jsonb_all_booleans(p_value jsonb, p_keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT pulse_jsonb_exact_keys(p_value,p_keys)
     AND NOT EXISTS (SELECT 1 FROM unnest(p_keys) k WHERE jsonb_typeof(p_value->k)<>'boolean');
$$;

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

CREATE OR REPLACE FUNCTION pulse_sdk_hash(p_config jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT encode(digest(
    pulse_canonical_jsonb(jsonb_set(p_config,'{meta}',COALESCE(p_config->'meta','{}'::jsonb)-'configHash')),
    'sha256'
  ),'hex');
$$;

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

CREATE OR REPLACE FUNCTION pulse_jsonb_pick_keys(p_value jsonb, p_keys text[])
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p_value)='object' THEN
    COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(p_value) WHERE key=ANY(p_keys)),'{}'::jsonb)
  ELSE '{}'::jsonb END;
$$;

CREATE OR REPLACE FUNCTION pulse_sdk_scalar(p_source jsonb, p_path text[], p_type text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v jsonb := p_source #> p_path;
BEGIN
  IF v IS NOT NULL AND jsonb_typeof(v)=p_type THEN RETURN v; END IF;
  RETURN NULL;
END;
$$;

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

-- Convert only allowlisted editable leaves. Legacy wrappers/names are mapped
-- where unambiguous; unknown/protected fields are discarded.
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

  v := pulse_jsonb_pick_keys(s->'sampling',ARRAY['errors','traces','spans','requests','metrics','logs','events','messages','profiles','replays','crons','routes']);
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
    'sampling',jsonb_build_object(
      'errors',1,'traces',1,'spans',1,'requests',1,'metrics',1,'logs',1,
      'events',1,'messages',1,'profiles',0.1,'replays',0.1,'crons',1,
      'routes',jsonb_build_object(
        '/health',jsonb_build_object('requests',0,'traces',0,'spans',0,'metrics',0,'logs',0),
        '/favicon.ico',jsonb_build_object('traces',0,'requests',0))),
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
  config := jsonb_set(config,'{privacy,scrubbing,headers}',pulse_jsonb_dedupe_strings(mandatory_headers,config #> '{privacy,scrubbing,headers}'),true);
  config := jsonb_set(config,'{privacy,scrubbing,fields}',pulse_jsonb_dedupe_strings(mandatory_fields,config #> '{privacy,scrubbing,fields}'),true);
  -- Identity, topology, compiler metadata, and entitlements are protected.
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
  IF NOT pulse_jsonb_number_between(c#>'{limits,maxSpansPerTrace}',1,5000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxSpanAttributes}',1,500,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxAttributeLength}',1,16384,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxPayloadSize}',1024,4194304,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,maxQueueSize}',1,100000,true)
     THEN RETURN false; END IF;
  IF NOT (
    (jsonb_typeof(c#>'{limits,maxMemoryMb}')='string' AND c#>>'{limits,maxMemoryMb}'='auto')
    OR pulse_jsonb_number_between(c#>'{limits,maxMemoryMb}',16,1024,true)
  ) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c#>'{limits,tenantGovernance}',ARRAY['enabled','maxTenantsTracked','quotaPerWindow','windowDurationMs','criticalReserve'])
     OR jsonb_typeof(c#>'{limits,tenantGovernance,enabled}')<>'boolean'
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,maxTenantsTracked}',1,100000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,quotaPerWindow}',1,1000000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,windowDurationMs}',1000,3600000,true)
     OR NOT pulse_jsonb_number_between(c#>'{limits,tenantGovernance,criticalReserve}',0,100000,true)
     OR (c#>>'{limits,tenantGovernance,criticalReserve}')::numeric>(c#>>'{limits,tenantGovernance,quotaPerWindow}')::numeric THEN RETURN false; END IF;
  IF NOT pulse_jsonb_all_booleans(c->'killswitches',ARRAY['disableSDK','disableTracing','disableMetrics','disableTransport','disableProfiling','disableErrors','disableLogs']) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'transport',ARRAY['retry','queue','connections','keepAlive','routes'])
     OR jsonb_typeof(c#>'{transport,keepAlive}')<>'boolean'
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,retry}',ARRAY['enabled','maxRetries','backoff','baseDelayMs'])
     OR jsonb_typeof(c#>'{transport,retry,enabled}')<>'boolean'
     OR NOT (c#>>'{transport,retry,backoff}'=ANY(ARRAY['exponential','linear','fixed']))
     OR NOT pulse_jsonb_number_between(c#>'{transport,retry,maxRetries}',0,10,true)
     OR NOT pulse_jsonb_number_between(c#>'{transport,retry,baseDelayMs}',100,30000,true)
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,queue}',ARRAY['overflowStrategy','maxSize','criticalReserve'])
     OR NOT (c#>>'{transport,queue,overflowStrategy}'=ANY(ARRAY['drop_oldest','drop_newest','reject']))
     OR NOT pulse_jsonb_number_between(c#>'{transport,queue,maxSize}',1,100000,true)
     OR NOT pulse_jsonb_number_between(c#>'{transport,queue,criticalReserve}',0,100000,true)
     OR (c#>>'{transport,queue,criticalReserve}')::numeric>(c#>>'{transport,queue,maxSize}')::numeric
     OR (c#>>'{limits,maxQueueSize}')::numeric>(c#>>'{transport,queue,maxSize}')::numeric
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,connections}',ARRAY['maxTotalConnections','acquireTimeoutMs'])
     OR NOT pulse_jsonb_number_between(c#>'{transport,connections,maxTotalConnections}',1,500,true)
     OR NOT pulse_jsonb_number_between(c#>'{transport,connections,acquireTimeoutMs}',100,60000,true)
     OR NOT pulse_jsonb_exact_keys(c#>'{transport,routes}',ARRAY['errors','events','traces','spans','requests','metrics','logs','profiles','crons','replays']) THEN RETURN false; END IF;
  FOR k,path IN SELECT * FROM (VALUES
    ('errors','/v1/errors'),('events','/v1/events'),('traces','/v1/traces'),('spans','/v1/spans'),
    ('requests','/v1/requests'),('metrics','/v1/metrics'),('logs','/v1/logs'),('profiles','/v1/profiles'),
    ('crons','/v1/checkins'),('replays','/v1/replays')) x(k,path) LOOP
    v := c#>ARRAY['transport','routes',k];
    IF NOT pulse_jsonb_exact_keys(v,ARRAY['url','batchSize','flushIntervalMs','timeoutMs','compression','priority'])
       OR COALESCE(v->>'url','') !~ ('^https?://.+'
           || regexp_replace(path,'([\\.^$|?*+(){}\\[\\]])','\\\1','g')
           || '$')
       OR NOT pulse_jsonb_number_between(v->'batchSize',1,5000,true)
       OR NOT pulse_jsonb_number_between(v->'flushIntervalMs',0,300000,true)
       OR NOT pulse_jsonb_number_between(v->'timeoutMs',250,60000,true)
       OR NOT (v->>'compression'=ANY(ARRAY['gzip','none']))
       OR NOT (v->>'priority'=ANY(ARRAY['critical','high','normal','low'])) THEN RETURN false; END IF;
  END LOOP;
  IF NOT pulse_jsonb_exact_keys(c->'runtime',ARRAY['configTtlSeconds','staleWhileRevalidate'])
     OR NOT pulse_jsonb_number_between(c#>'{runtime,configTtlSeconds}',30,86400,true)
     OR jsonb_typeof(c#>'{runtime,staleWhileRevalidate}')<>'boolean' THEN RETURN false; END IF;
  IF NOT pulse_jsonb_exact_keys(c->'meta',ARRAY['generatedAt','generatedBy','configHash'])
     OR COALESCE(c#>>'{meta,generatedAt}','')=''
     OR c#>>'{meta,generatedBy}'<>'pulse-config-compiler@1'
     OR COALESCE(c#>>'{meta,configHash}','') !~ '^[0-9a-f]{64}$'
     OR c#>>'{meta,configHash}'<>pulse_sdk_hash(c) THEN RETURN false; END IF;
  IF NOT pulse_jsonb_all_booleans(c->'entitlements',ARRAY['customSpans','customMetrics','profiling','logging','sessionReplay','crons','requestCapture','tracing','errors','metrics']) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END;
$$;

ALTER TABLE project_environment_sdk_config_revisions
  DISABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

WITH source AS (
  SELECT r.id,r.published_at,e.project_id,e.slug,
         pulse_extract_sdk_intent(CASE
           WHEN jsonb_typeof(r.requested_config)='object' AND r.requested_config<>'{}'::jsonb THEN r.requested_config
           ELSE COALESCE(r.compiled_snapshot,'{}'::jsonb)
         END) AS intent
    FROM project_environment_sdk_config_revisions r
    JOIN project_environments e ON e.id=r.environment_id
), candidate AS (
  SELECT s.*,pulse_build_sdk_config(
    s.project_id,s.slug,to_char(s.published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),s.intent
  ) AS compiled
  FROM source s
), resolved AS (
  SELECT id,
         CASE WHEN pulse_sdk_config_valid(compiled) THEN intent ELSE '{}'::jsonb END AS intent,
         CASE WHEN pulse_sdk_config_valid(compiled) THEN compiled ELSE pulse_build_sdk_config(
           project_id,slug,to_char(published_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'{}'::jsonb
         ) END AS compiled
    FROM candidate
)
UPDATE project_environment_sdk_config_revisions r
   SET requested_config=resolved.intent,
       compiled_snapshot=resolved.compiled,
       config_hash=resolved.compiled#>>'{meta,configHash}',
       schema_version='1'
  FROM resolved WHERE resolved.id=r.id;

UPDATE project_environment_sdk_configs h
   SET current_revision=r.revision_number,
       current_hash=r.config_hash,
       schema_version='1',
       updated_at=NOW(),
       version=version+1
  FROM project_environment_sdk_config_revisions r
 WHERE r.id=h.published_revision_id;

ALTER TABLE project_environment_sdk_config_revisions
  DROP CONSTRAINT IF EXISTS sdk_revisions_compiled_snapshot_object,
  DROP CONSTRAINT IF EXISTS sdk_revisions_compiled_contract,
  DROP CONSTRAINT IF EXISTS sdk_revisions_hash_matches_snapshot;
ALTER TABLE project_environment_sdk_config_revisions
  ADD CONSTRAINT sdk_revisions_compiled_contract CHECK (pulse_sdk_config_valid(compiled_snapshot)),
  ADD CONSTRAINT sdk_revisions_hash_matches_snapshot CHECK (
    config_hash=compiled_snapshot#>>'{meta,configHash}' AND config_hash=pulse_sdk_hash(compiled_snapshot)
  );

-- Remove the second/legacy full-document representation.
ALTER TABLE project_environment_sdk_config_revisions DROP COLUMN IF EXISTS config_value;
DROP FUNCTION IF EXISTS pulse_build_initial_sdk_config(uuid,text);

-- The SQL builder and legacy conversion helpers exist only for this one-time
-- historical transition. Runtime initialization, publishing, and rollback use
-- RemoteSdkConfigService and the TypeScript compiler exclusively.
DROP FUNCTION pulse_build_sdk_config(uuid,text,text,jsonb);
DROP FUNCTION pulse_extract_sdk_intent(jsonb);
DROP FUNCTION pulse_jsonb_deep_merge(jsonb,jsonb);
DROP FUNCTION pulse_jsonb_pick_keys(jsonb,text[]);
DROP FUNCTION pulse_sdk_scalar(jsonb,text[],text);
DROP FUNCTION pulse_jsonb_dedupe_strings(jsonb,jsonb);

ALTER TABLE project_environment_sdk_config_revisions
  ENABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

COMMENT ON COLUMN project_environment_sdk_config_revisions.compiled_snapshot IS
  'The only complete SDK config document; exact schema-v1 contract with canonical hash.';

COMMIT;
