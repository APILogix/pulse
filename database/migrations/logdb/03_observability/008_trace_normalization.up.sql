BEGIN;

ALTER TABLE events_spans
  ADD COLUMN IF NOT EXISTS span_kind TEXT,
  ADD COLUMN IF NOT EXISTS span_type TEXT,
  ADD COLUMN IF NOT EXISTS span_status TEXT,
  ADD COLUMN IF NOT EXISTS is_root_span BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_http_span BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_db_span BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_cache_span BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_messaging_span BOOLEAN,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS endpoint TEXT,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS http_target TEXT,
  ADD COLUMN IF NOT EXISTS http_scheme TEXT,
  ADD COLUMN IF NOT EXISTS http_flavor TEXT,
  ADD COLUMN IF NOT EXISTS http_status_text TEXT,
  ADD COLUMN IF NOT EXISTS http_response_size BIGINT,
  ADD COLUMN IF NOT EXISTS http_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS client_ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS net_transport TEXT,
  ADD COLUMN IF NOT EXISTS net_host_name TEXT,
  ADD COLUMN IF NOT EXISTS net_host_ip TEXT,
  ADD COLUMN IF NOT EXISTS net_host_port INTEGER,
  ADD COLUMN IF NOT EXISTS net_peer_ip TEXT,
  ADD COLUMN IF NOT EXISTS net_peer_port INTEGER;

ALTER TABLE events_traces
  ADD COLUMN IF NOT EXISTS http_method TEXT,
  ADD COLUMN IF NOT EXISTS response_size BIGINT,
  ADD COLUMN IF NOT EXISTS span_kind TEXT,
  ADD COLUMN IF NOT EXISTS root_span_status TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS client_ip_hash TEXT;

UPDATE events_spans
SET
  span_kind = COALESCE(span_kind, kind, payload->>'kind'),
  span_status = COALESCE(span_status, status, payload->>'status'),
  message = COALESCE(message, status_message, payload->>'statusMessage'),
  endpoint = COALESCE(endpoint, attributes #>> '{http,route}', attributes->>'http.route', attributes->>'route'),
  occurred_at = COALESCE(
    occurred_at,
    timestamp,
    CASE
      WHEN payload->>'timestamp' ~ '^[0-9]+$' THEN to_timestamp((payload->>'timestamp')::numeric / 1000)
      ELSE NULLIF(payload->>'timestamp', '')::timestamptz
    END
  ),
  timestamp = COALESCE(
    timestamp,
    occurred_at,
    CASE
      WHEN payload->>'timestamp' ~ '^[0-9]+$' THEN to_timestamp((payload->>'timestamp')::numeric / 1000)
      ELSE NULLIF(payload->>'timestamp', '')::timestamptz
    END
  ),
  request_id = COALESCE(request_id, payload->>'requestId', attributes #>> '{pulse,request_id}', attributes->>'pulse.request_id'),
  tenant_id = COALESCE(tenant_id, payload->>'tenantId', attributes #>> '{pulse,tenant_id}', attributes->>'pulse.tenant_id'),
  environment = COALESCE(environment, payload #>> '{metadata,environment}'),
  sdk_name = COALESCE(sdk_name, payload #>> '{metadata,sdkName}'),
  sdk_version = COALESCE(sdk_version, payload #>> '{metadata,sdkVersion}'),
  application_name = COALESCE(application_name, payload #>> '{metadata,applicationName}'),
  application_version = COALESCE(application_version, payload #>> '{metadata,applicationVersion}'),
  release = COALESCE(release, payload #>> '{metadata,release}'),
  http_method = COALESCE(http_method, attributes #>> '{http,method}', attributes->>'http.method'),
  http_route = COALESCE(http_route, attributes #>> '{http,route}', attributes->>'http.route'),
  http_url = COALESCE(http_url, attributes #>> '{http,url}', attributes->>'http.url'),
  http_target = COALESCE(http_target, attributes #>> '{http,target}', attributes->>'http.target'),
  http_host = COALESCE(http_host, attributes #>> '{http,host}', attributes->>'http.host'),
  http_scheme = COALESCE(http_scheme, attributes #>> '{http,scheme}', attributes->>'http.scheme'),
  http_flavor = COALESCE(http_flavor, attributes #>> '{http,flavor}', attributes->>'http.flavor'),
  http_status_code = COALESCE(http_status_code, NULLIF(COALESCE(attributes #>> '{http,status_code}', attributes->>'http.status_code'), '')::integer),
  http_status_text = COALESCE(http_status_text, attributes #>> '{http,status_text}', attributes->>'http.status_text'),
  http_response_size = COALESCE(http_response_size, NULLIF(COALESCE(attributes #>> '{http,response,body,size}', attributes->>'http.response.body.size'), '')::bigint),
  http_user_agent = COALESCE(http_user_agent, attributes #>> '{http,user_agent}', attributes->>'http.user_agent'),
  client_ip_hash = COALESCE(client_ip_hash, attributes #>> '{http,client_ip}', attributes->>'http.client_ip'),
  net_transport = COALESCE(net_transport, attributes #>> '{net,transport}', attributes->>'net.transport'),
  net_host_name = COALESCE(net_host_name, attributes #>> '{net,host,name}', attributes->>'net.host.name'),
  net_host_ip = COALESCE(net_host_ip, attributes #>> '{net,host,ip}', attributes->>'net.host.ip'),
  net_host_port = COALESCE(net_host_port, NULLIF(COALESCE(attributes #>> '{net,host,port}', attributes->>'net.host.port'), '')::integer),
  net_peer_ip = COALESCE(net_peer_ip, attributes #>> '{net,peer,ip}', attributes->>'net.peer.ip'),
  net_peer_port = COALESCE(net_peer_port, NULLIF(COALESCE(attributes #>> '{net,peer,port}', attributes->>'net.peer.port'), '')::integer),
  db_system = COALESCE(db_system, attributes #>> '{db,system}', attributes->>'db.system'),
  db_name = COALESCE(db_name, attributes #>> '{db,name}', attributes->>'db.name'),
  db_operation = COALESCE(db_operation, attributes #>> '{db,operation}', attributes->>'db.operation'),
  db_collection = COALESCE(db_collection, attributes #>> '{db,collection}', attributes->>'db.collection'),
  db_statement = COALESCE(db_statement, attributes #>> '{db,statement}', attributes->>'db.statement', attributes->>'query'),
  messaging_system = COALESCE(messaging_system, attributes #>> '{messaging,system}', attributes->>'messaging.system'),
  messaging_destination = COALESCE(messaging_destination, attributes #>> '{messaging,destination}', attributes->>'messaging.destination'),
  messaging_operation = COALESCE(messaging_operation, attributes #>> '{messaging,operation}', attributes->>'messaging.operation');

UPDATE events_spans
SET
  span_type = COALESCE(span_type, CASE
    WHEN http_method IS NOT NULL OR http_route IS NOT NULL OR http_url IS NOT NULL THEN 'http'
    WHEN db_system IS NOT NULL AND (LOWER(COALESCE(name, '')) LIKE '%redis%' OR LOWER(COALESCE(name, '')) LIKE '%memcache%') THEN 'cache'
    WHEN db_system IS NOT NULL THEN 'database'
    WHEN messaging_system IS NOT NULL AND span_kind = 'producer' THEN 'producer'
    WHEN messaging_system IS NOT NULL AND span_kind = 'consumer' THEN 'consumer'
    WHEN messaging_system IS NOT NULL THEN 'messaging'
    WHEN LOWER(COALESCE(name, '')) LIKE '%queue%' THEN 'queue'
    WHEN LOWER(COALESCE(name, '')) LIKE '%rpc%' OR LOWER(COALESCE(name, '')) LIKE '%grpc%' THEN 'rpc'
    WHEN LOWER(COALESCE(name, '')) LIKE '%cron%' THEN 'cron'
    WHEN LOWER(COALESCE(name, '')) LIKE '%schedule%' THEN 'scheduler'
    WHEN span_kind = 'producer' THEN 'producer'
    WHEN span_kind = 'consumer' THEN 'consumer'
    WHEN span_kind = 'internal' THEN 'internal'
    ELSE 'unknown'
  END),
  is_root_span = COALESCE(is_root_span, parent_span_id IS NULL),
  is_http_span = COALESCE(is_http_span, http_method IS NOT NULL OR http_route IS NOT NULL OR http_url IS NOT NULL),
  is_db_span = COALESCE(is_db_span, db_system IS NOT NULL),
  is_cache_span = COALESCE(is_cache_span, span_type = 'cache'),
  is_messaging_span = COALESCE(is_messaging_span, messaging_system IS NOT NULL OR span_type IN ('messaging','queue','producer','consumer'));

UPDATE events_spans
SET attributes = COALESCE(attributes, '{}'::jsonb)
  #- '{http,method}' #- '{http,route}' #- '{http,target}' #- '{http,url}' #- '{http,host}' #- '{http,scheme}'
  #- '{http,flavor}' #- '{http,status_code}' #- '{http,status_text}' #- '{http,response,body,size}' #- '{http,user_agent}' #- '{http,client_ip}'
  #- '{net,transport}' #- '{net,host,name}' #- '{net,host,ip}' #- '{net,host,port}' #- '{net,peer,ip}' #- '{net,peer,port}'
  #- '{db,system}' #- '{db,name}' #- '{db,operation}' #- '{db,collection}' #- '{db,statement}'
  #- '{messaging,system}' #- '{messaging,destination}' #- '{messaging,operation}'
  #- '{pulse,request_id}' #- '{pulse,tenant_id}'
  - 'http.method' - 'http.route' - 'route' - 'http.target' - 'http.url' - 'http.host' - 'http.scheme' - 'http.flavor'
  - 'http.status_code' - 'http.status_text' - 'http.response.body.size' - 'http.user_agent' - 'http.client_ip'
  - 'net.transport' - 'net.host.name' - 'net.host.ip' - 'net.host.port' - 'net.peer.ip' - 'net.peer.port'
  - 'db.system' - 'db.name' - 'db.operation' - 'db.collection' - 'db.statement' - 'query'
  - 'messaging.system' - 'messaging.destination' - 'messaging.operation'
  - 'pulse.request_id' - 'pulse.tenant_id';

UPDATE events_traces
SET
  root_span_id = COALESCE(root_span_id, spans_tree->>'spanId', spans_tree->>'id'),
  root_span_name = COALESCE(root_span_name, spans_tree->>'name'),
  span_kind = COALESCE(span_kind, spans_tree->>'kind'),
  root_span_status = COALESCE(root_span_status, spans_tree->>'status'),
  duration_ms = COALESCE(duration_ms, NULLIF(spans_tree->>'duration', '')::numeric),
  endpoint = COALESCE(endpoint, spans_tree #>> '{attributes,http.route}', spans_tree #>> '{attributes,route}'),
  http_method = COALESCE(http_method, spans_tree #>> '{attributes,http.method}'),
  status_code = COALESCE(status_code, NULLIF(spans_tree #>> '{attributes,http.status_code}', '')::integer),
  response_size = COALESCE(response_size, NULLIF(spans_tree #>> '{attributes,http.response.body.size}', '')::bigint),
  user_agent = COALESCE(user_agent, spans_tree #>> '{attributes,http.user_agent}')
WHERE spans_tree IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_spans_trace_time
  ON events_spans(organization_id, project_id, trace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_spans_span_id
  ON events_spans(organization_id, project_id, span_id)
  WHERE span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_parent_time
  ON events_spans(organization_id, project_id, trace_id, parent_span_id, start_time)
  WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_request_time
  ON events_spans(organization_id, project_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_endpoint_time
  ON events_spans(organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_type_time
  ON events_spans(organization_id, project_id, span_type, occurred_at DESC)
  WHERE span_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_http_method_time
  ON events_spans(organization_id, project_id, http_method, occurred_at DESC)
  WHERE http_method IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_http_status_time
  ON events_spans(organization_id, project_id, http_status_code, occurred_at DESC)
  WHERE http_status_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_db_system_time
  ON events_spans(organization_id, project_id, db_system, occurred_at DESC)
  WHERE db_system IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_tenant_time
  ON events_spans(organization_id, project_id, tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_spans_depth
  ON events_spans(organization_id, project_id, trace_id, depth)
  WHERE depth IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_traces_trace_time
  ON events_traces(organization_id, project_id, trace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_traces_request_time
  ON events_traces(organization_id, project_id, request_id, occurred_at DESC)
  WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_traces_endpoint_time
  ON events_traces(organization_id, project_id, endpoint, occurred_at DESC)
  WHERE endpoint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_traces_status_time
  ON events_traces(organization_id, project_id, status_code, occurred_at DESC)
  WHERE status_code IS NOT NULL;

COMMIT;
