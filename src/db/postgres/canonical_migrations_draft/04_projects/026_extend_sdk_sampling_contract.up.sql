BEGIN;

-- Extend schema-v1 SDK sampling to all event families emitted by the transport:
-- errors, traces, spans, requests, metrics, logs, events, messages, profiles,
-- replays and crons. Existing active/revision snapshots are backfilled in-place
-- and hashes are recomputed so delivery keeps serving valid compiled configs.

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

ALTER TABLE project_environment_sdk_config_revisions DISABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

WITH updated AS (
  SELECT
    id,
    jsonb_set(compiled_snapshot,'{sampling}',pulse_sdk_sampling_v2(compiled_snapshot->'sampling'),true) AS snapshot
  FROM project_environment_sdk_config_revisions
)
UPDATE project_environment_sdk_config_revisions r
SET
  compiled_snapshot = jsonb_set(updated.snapshot,'{meta,configHash}',to_jsonb(pulse_sdk_hash(updated.snapshot)),true),
  config_hash = pulse_sdk_hash(updated.snapshot)
FROM updated
WHERE r.id = updated.id;

ALTER TABLE project_environment_sdk_config_revisions ENABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

UPDATE project_environment_sdk_configs c
SET current_hash = r.config_hash
FROM project_environment_sdk_config_revisions r
WHERE c.published_revision_id = r.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM project_environment_sdk_config_revisions
    WHERE NOT pulse_sdk_config_valid(compiled_snapshot)
  ) THEN
    RAISE EXCEPTION 'SDK sampling contract backfill produced invalid compiled snapshots';
  END IF;
END $$;

COMMIT;
