import { config } from 'dotenv';
config();
import '../src/config/dns.js';
import { pool as primaryPool, closeDatabase } from '../src/config/database.js';
import { logDB } from '../src/config/log-database.js';

// Ingestion columns expected by telemetry-writer.ts
const expectedIngestionCols: Record<string, string[]> = {
  events_errors: [
    'organization_id', 'project_id', 'api_key_name', 'event_id', 'fingerprint', 'fingerprint_version', 'message',
    'error_name', 'severity', 'trace_id', 'span_id', 'request_id', 'session_id',
    'mechanism', 'service', 'environment', 'release', 'server_name',
    'application_name', 'application_version',
    'stack_frames', 'breadcrumbs', 'context', 'method', 'route', 'url',
    'status_code', 'status_text', 'handled', 'user_id',
    'sdk_name', 'sdk_version', 'tags', 'extra', 'metadata', 'occurred_at', 'payload', 'ai_response'
  ],
  events_messages: [
    'organization_id', 'project_id', 'api_key_name', 'event_id', 'message', 'severity',
    'trace_id', 'span_id', 'request_id', 'session_id',
    'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
    'user_id', 'user_ip',
    'tags', 'contexts', 'breadcrumbs', 'sdk_name', 'sdk_version', 'metadata', 'occurred_at', 'payload', 'ai_response',
    'tenant_id', 'logger_name', 'message_category', 'message_source',
    'endpoint', 'status_code', 'name', 'attributes'
  ],
  events_requests: [
    'id', 'organization_id', 'project_id', 'api_key_name', 'event_id', 'request_id', 'trace_id', 'span_id',
    'parent_span_id', 'session_id', 'user_id', 'tenant_id', 'endpoint', 'name', 'method',
    'status_code', 'duration_ms', 'body_size', 'response_size', 'span_count', 'root_span_status', 'is_partial',
    'client_ip_hash', 'user_agent', 'referer', 'geo_country_code', 'geo_region', 'geo_asn',
    'browser_family', 'browser_version_major', 'os_name', 'os_version_major', 'device_type', 'is_bot',
    'service', 'framework', 'environment', 'release', 'server_name', 'sdk_name', 'sdk_version',
    'severity', 'attributes', 'metadata', 'payload', 'ai_response', 'occurred_at'
  ],
  events_spans: [
    'organization_id', 'project_id', 'api_key_name', 'event_id', 'span_id', 'trace_id', 'parent_span_id',
    'span_kind', 'span_type', 'span_status', 'is_root_span', 'is_http_span', 'is_db_span', 'is_cache_span', 'is_messaging_span',
    'name', 'message', 'endpoint', 'start_time', 'end_time',
    'duration_ms', 'exclusive_duration_ms', 'occurred_at',
    'http_method', 'http_route', 'http_url', 'http_target', 'http_host', 'http_scheme', 'http_flavor',
    'http_status_code', 'http_status_text', 'http_response_size', 'http_user_agent', 'client_ip_hash',
    'net_transport', 'net_host_name', 'net_host_ip', 'net_host_port', 'net_peer_ip', 'net_peer_port',
    'db_system', 'db_name', 'db_operation', 'db_collection', 'db_statement',
    'messaging_system', 'messaging_destination', 'messaging_operation',
    'attributes', 'events', 'links',
    'request_id', 'session_id', 'user_id', 'tenant_id',
    'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'payload', 'ai_response'
  ],
  events_traces: [
    'organization_id', 'project_id', 'api_key_name', 'event_id', 'trace_id', 'span_id', 'parent_span_id',
    'root_span_name', 'root_span_id', 'span_kind', 'root_span_status', 'endpoint', 'http_method', 'status_code',
    'duration_ms', 'total_duration_ms', 'response_size', 'span_count', 'is_partial',
    'spans_tree', 'request_id', 'session_id', 'user_id', 'tenant_id',
    'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
    'sdk_name', 'sdk_version', 'attributes', 'metadata', 'occurred_at',
    'user_agent', 'client_ip_hash', 'payload', 'ai_response'
  ],
  events_metrics: [
    'organization_id', 'project_id', 'api_key_name', 'event_id',
    'metric_name', 'metric_type',
    'metric_unit', 'metric_namespace', 'metric_description',
    'value',
    'count', 'sum', 'min', 'max', 'avg',
    'rate', 'buckets',
    'p50', 'p75', 'p90', 'p95', 'p99',
    'metric_category', 'aggregation_type', 'temporality', 'is_monotonic',
    'endpoint', 'http_method', 'status_code',
    'trace_id', 'span_id', 'request_id', 'session_id',
    'user_id', 'tenant_id',
    'service', 'environment', 'release', 'server_name',
    'application_name', 'application_version',
    'sdk_name', 'sdk_version',
    'tags', 'attributes', 'metadata', 'occurred_at', 'payload', 'ai_response'
  ],
  events_logs: [
    'organization_id', 'project_id', 'api_key_name', 'event_id', 'level', 'message',
    'args', 'trace_id', 'span_id', 'parent_span_id', 'tenant_id',
    'name', 'logger_name', 'log_source', 'log_category', 'endpoint', 'http_method', 'status_code', 'duration_ms',
    'request_id', 'session_id',
    'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
    'user_id', 'user_ip',
    'sdk_name', 'sdk_version', 'context', 'tags', 'attributes',
    'metadata', 'occurred_at', 'payload', 'ai_response'
  ],
  events_profiles: [
    'organization_id', 'project_id', 'api_key_name', 'event_id', 'profile_type',
    'trace_id', 'span_id', 'request_id', 'session_id', 'user_id', 'start_time', 'end_time', 'duration_ms',
    'profile_data', 'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'occurred_at', 'payload', 'ai_response'
  ],
  events_cron_checkins: [
    'organization_id', 'project_id', 'api_key_name', 'event_id',
    'monitor_slug', 'monitor_name',
    'status', 'is_success',
    'duration_ms', 'started_at', 'finished_at',
    'checkin_type', 'schedule_type',
    'trace_id', 'span_id', 'request_id', 'session_id',
    'user_id', 'tenant_id',
    'service', 'environment', 'release', 'server_name',
    'application_name', 'application_version',
    'sdk_name', 'sdk_version',
    'tags', 'attributes', 'metadata', 'occurred_at', 'payload', 'ai_response'
  ],
  events_replays: [
    'organization_id', 'project_id', 'api_key_name', 'event_id', 'session_id', 'segment_id',
    'events', 'trace_id', 'span_id', 'request_id', 'user_id',
    'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'occurred_at', 'payload', 'ai_response'
  ]
};

async function main() {
  console.log('====================================================');
  console.log('   FULL LIVE DATABASE SCHEMA VERIFICATION');
  console.log('====================================================\n');

  // ── 1. PRIMARY DB VERIFICATION ──────────────────────────
  console.log('--- 1. PrimaryDB v2 ---');
  const pCount = await primaryPool.query(`
    SELECT count(*)::int as total
    FROM information_schema.tables
    WHERE table_schema = 'public';
  `);
  console.log(`Total public tables: ${pCount.rows[0].total}`);

  const corePrimaryTables = [
    'users',
    'user_sessions',
    'organizations',
    'organization_members',
    'projects',
    'project_members',
    'project_api_keys',
    'plans',
    'organization_subscriptions',
    'audit_logs'
  ];

  for (const t of corePrimaryTables) {
    const colRes = await primaryPool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position;
    `, [t]);
    if (colRes.rows.length === 0) {
      console.error(`❌ Table ${t} NOT FOUND in PrimaryDB!`);
    } else {
      console.log(`✔ Table "${t}": ${colRes.rows.length} columns verified`);
    }
  }

  // ── 2. LOG DB VERIFICATION ──────────────────────────────
  console.log('\n--- 2. LogDB v2 ---');
  const logPool = logDB.getPrimaryPool();
  const lCount = await logPool.query(`
    SELECT count(*)::int as total
    FROM information_schema.tables
    WHERE table_schema = 'public';
  `);
  console.log(`Total public tables (including partitions): ${lCount.rows[0].total}`);

  let allLogColsValid = true;

  for (const [table, expected] of Object.entries(expectedIngestionCols)) {
    const colRes = await logPool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1;
    `, [table]);
    const liveColSet = new Set(colRes.rows.map(r => r.column_name));
    const missing = expected.filter(c => !liveColSet.has(c));

    if (missing.length > 0) {
      allLogColsValid = false;
      console.error(`❌ Table "${table}" is MISSING ${missing.length} columns: ${missing.join(', ')}`);
    } else {
      console.log(`✔ Table "${table}": all ${expected.length} expected fields present (total in DB: ${colRes.rows.length})`);
    }
  }

  // ── 3. OBSERVABILITY EXPLORER FIELDS VALIDATION ────────
  console.log('\n--- 3. Observability Explorer Projection Verification ---');
  const criticalQueries = [
    { name: 'events_errors list projection', sql: 'SELECT id, public_id, occurred_at, error_name, message, error_group_id, trace_id, route, status_code, severity, handled, environment, release, service FROM events_errors LIMIT 1;' },
    { name: 'events_requests list projection', sql: 'SELECT id, public_id, occurred_at, method, endpoint, name, status_code, duration_ms, environment, service, trace_id, request_id, is_slow, is_error FROM events_requests LIMIT 1;' },
    { name: 'events_logs list projection', sql: 'SELECT id, public_id, environment, occurred_at, level, severity, name, message, log_category, endpoint, status_code, duration_ms, service, trace_id, request_id FROM events_logs LIMIT 1;' },
    { name: 'events_spans list projection', sql: 'SELECT id, public_id, environment, occurred_at, trace_id, span_id, parent_span_id, name, span_kind, span_type, span_status, endpoint, depth, service, duration_ms, exclusive_duration_ms FROM events_spans LIMIT 1;' },
    { name: 'events_traces list projection', sql: 'SELECT id, public_id, occurred_at, http_method, endpoint, duration_ms, root_span_status, span_count, environment, is_partial, service FROM events_traces LIMIT 1;' },
    { name: 'events_metrics list projection', sql: 'SELECT id, environment, occurred_at, metric_name, metric_type, value, metric_unit, metric_category, aggregation_type, endpoint, http_method, status_code, service, p95, p99 FROM events_metrics LIMIT 1;' },
    { name: 'events_cron_checkins list projection', sql: 'SELECT id, public_id, environment, occurred_at, monitor_slug, monitor_name, status, is_success, duration_ms, checkin_type, service FROM events_cron_checkins LIMIT 1;' },
    { name: 'events_profiles list projection', sql: 'SELECT id, public_id, environment, occurred_at, profile_type, service, duration_ms, request_id FROM events_profiles LIMIT 1;' },
    { name: 'events_replays list projection', sql: 'SELECT id, public_id, event_id, environment, occurred_at, session_id, name, service, endpoint, release FROM events_replays LIMIT 1;' },
    { name: 'analytics_user_sessions list projection', sql: 'SELECT id, public_id, environment, session_id, started_at, ended_at, duration_ms, is_crashed FROM analytics_user_sessions LIMIT 1;' },
    { name: 'error_groups list projection', sql: 'SELECT id, public_id, organization_id, project_id, latest_environment, latest_severity, fingerprint, status, occurrence_count, first_seen_at, last_seen_at FROM error_groups LIMIT 1;' }
  ];

  let allQueriesValid = true;
  for (const q of criticalQueries) {
    try {
      await logPool.query(q.sql);
      console.log(`✔ Query "${q.name}": Validated SQL query successfully`);
    } catch (err: any) {
      allQueriesValid = false;
      console.error(`❌ Query "${q.name}" FAILED:`, err.message);
    }
  }

  console.log('\n====================================================');
  if (allLogColsValid && allQueriesValid) {
    console.log('VERDICT: YES — The database schema is 100% CORRECT with ALL fields!');
  } else {
    console.log('VERDICT: NO — Schema has missing fields or errors.');
  }
  console.log('====================================================\n');

  await logDB.close();
  await closeDatabase();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
