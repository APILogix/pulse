const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../src/modules/ingestion/pipeline/telemetry-writer.ts');
let content = fs.readFileSync(target, 'utf8');

// Normalize newlines to LF for matching
content = content.replace(/\r\n/g, '\n');

// Replace return arrays for each method
const replacements = [
  {
    type: 'writeErrors',
    find: `JSON.stringify(e.breadcrumbs ?? []),
        JSON.stringify(r.tags ?? {}), JSON.stringify(r.extra ?? {}), JSON.stringify(e.context ?? {}),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`,
    replace: `JSON.stringify(e.breadcrumbs ?? []),
        JSON.stringify(r.tags ?? {}), JSON.stringify(r.extra ?? {}), JSON.stringify(e.context ?? {}),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`
  },
  {
    type: 'events_errors',
    find: `'breadcrumbs', 'tags', 'extra', 'contexts', 'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`,
    replace: `'breadcrumbs', 'tags', 'extra', 'contexts', 'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`
  },
  {
    type: 'writeMessages',
    find: `JSON.stringify(r.tags ?? {}), JSON.stringify(e.context ?? {}), JSON.stringify(e.breadcrumbs ?? []),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`,
    replace: `JSON.stringify(r.tags ?? {}), JSON.stringify(e.context ?? {}), JSON.stringify(e.breadcrumbs ?? []),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`
  },
  {
    type: 'events_messages',
    find: `'tags', 'contexts', 'breadcrumbs', 'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`,
    replace: `'tags', 'contexts', 'breadcrumbs', 'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`
  },
  {
    type: 'writeRequests',
    find: `g.browserFamily, g.browserVersionMajor, g.osName, g.osVersionMajor,
        g.deviceType, g.isBot,
      ];`,
    replace: `g.browserFamily, g.browserVersionMajor, g.osName, g.osVersionMajor,
        g.deviceType, g.isBot, e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`
  },
  {
    type: 'events_requests',
    find: `'browser_family', 'browser_version_major', 'os_name', 'os_version_major',
       'device_type', 'is_bot'],`,
    replace: `'browser_family', 'browser_version_major', 'os_name', 'os_version_major',
       'device_type', 'is_bot', 'ai_response'],`
  },
  {
    type: 'writeSpans',
    find: `str(r.service, 100), environment, str(r.release, 100),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`,
    replace: `str(r.service, 100), environment, str(r.release, 100),
        str(r.serverName, 100), str(r.applicationName, 100), str(r.applicationVersion, 50),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`
  },
  {
    type: 'events_spans',
    find: `'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`,
    replace: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`
  },
  {
    type: 'writeTraces_return',
    find: `orgId, projectId, this.eventId(event), e.traceId,
        str(root.name, 500), str(root.spanId ?? root.id, 64),
        e.spanCount, num(e.totalDuration), e.isPartial ?? false,
        e.rootSpan != null ? JSON.stringify(e.rootSpan) : null,
        e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255), str(r.tenantId, 255),
        str(r.service, 100), environment, str(r.release, 100),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`,
    replace: `orgId, projectId, this.eventId(event), e.traceId, e.spanId ?? null,
        str(root.name, 500), str(root.spanId ?? root.id, 64),
        e.spanCount, num(e.totalDuration), e.isPartial ?? false,
        e.rootSpan != null ? JSON.stringify(e.rootSpan) : null,
        e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255), str(r.tenantId, 255),
        str(r.service, 100), environment, str(r.release, 100),
        str(r.serverName, 100), str(r.applicationName, 100), str(r.applicationVersion, 50),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`
  },
  {
    type: 'writeTraces_cols',
    find: `'organization_id', 'project_id', 'event_id', 'trace_id',
       'root_span_name', 'root_span_id', 'span_count', 'total_duration_ms', 'is_partial',
       'spans_tree', 'request_id', 'session_id', 'user_id', 'tenant_id',
       'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`,
    replace: `'organization_id', 'project_id', 'event_id', 'trace_id', 'span_id',
       'root_span_name', 'root_span_id', 'span_count', 'total_duration_ms', 'is_partial',
       'spans_tree', 'request_id', 'session_id', 'user_id', 'tenant_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`
  },
  {
    type: 'writeMetrics_return',
    find: `e.traceId ?? null, e.spanId ?? null, e.requestId ?? null,
        str(r.service, 100), environment, str(r.release, 100),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`,
    replace: `e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255),
        str(r.service, 100), environment, str(r.release, 100),
        str(r.serverName, 100), str(r.applicationName, 100), str(r.applicationVersion, 50),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`
  },
  {
    type: 'writeMetrics_cols',
    find: `'trace_id', 'span_id', 'request_id', 'service', 'environment', 'release',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`,
    replace: `'trace_id', 'span_id', 'request_id', 'session_id', 'user_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`
  },
  {
    type: 'writeLogs_return',
    find: `JSON.stringify(e.args ?? []), e.traceId ?? null, e.spanId ?? null, e.requestId ?? null,
        str(r.service, 100), environment, str(r.release, 100),
        str(r.userId, 255), inet(r.userIp),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`,
    replace: `JSON.stringify(e.args ?? []), e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null,
        str(r.service, 100), environment, str(r.release, 100),
        str(r.serverName, 100), str(r.applicationName, 100), str(r.applicationVersion, 50),
        str(r.userId, 255), inet(r.userIp),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`
  },
  {
    type: 'writeLogs_cols',
    find: `'args', 'trace_id', 'span_id', 'request_id',
       'service', 'environment', 'release', 'user_id', 'user_ip',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`,
    replace: `'args', 'trace_id', 'span_id', 'request_id', 'session_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'user_id', 'user_ip',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`
  },
  {
    type: 'writeProfiles_return',
    find: `e.traceId ?? null, e.spanId ?? null, e.requestId ?? null,
        e.startTime != null ? iso(e.startTime) : iso(ts),
        e.endTime != null ? iso(e.endTime) : null, num(e.duration),
        e.profile != null ? JSON.stringify(e.profile) : null,
        str(r.service, 100), environment, str(r.release, 100),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(ts),
      ];`,
    replace: `e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255),
        e.startTime != null ? iso(e.startTime) : iso(ts),
        e.endTime != null ? iso(e.endTime) : null, num(e.duration),
        e.profile != null ? JSON.stringify(e.profile) : null,
        str(r.service, 100), environment, str(r.release, 100),
        str(r.serverName, 100), str(r.applicationName, 100), str(r.applicationVersion, 50),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(ts),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`
  },
  {
    type: 'writeProfiles_cols',
    find: `'trace_id', 'span_id', 'request_id', 'start_time', 'end_time', 'duration_ms',
       'profile_data', 'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`,
    replace: `'trace_id', 'span_id', 'request_id', 'session_id', 'user_id', 'start_time', 'end_time', 'duration_ms',
       'profile_data', 'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`
  },
  {
    type: 'writeCronCheckins_return',
    find: `orgId, projectId, this.eventId(event), e.monitorSlug, e.status, num(e.duration),
        str(r.service, 100), environment, str(r.release, 100),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`,
    replace: `orgId, projectId, this.eventId(event), e.monitorSlug, e.status, num(e.duration),
        e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, e.sessionId ?? null, str(r.userId, 255),
        str(r.service, 100), environment, str(r.release, 100),
        str(r.serverName, 100), str(r.applicationName, 100), str(r.applicationVersion, 50),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`
  },
  {
    type: 'writeCronCheckins_cols',
    find: `'organization_id', 'project_id', 'event_id', 'monitor_slug', 'status', 'duration_ms',
       'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`,
    replace: `'organization_id', 'project_id', 'event_id', 'monitor_slug', 'status', 'duration_ms',
       'trace_id', 'span_id', 'request_id', 'session_id', 'user_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`
  },
  {
    type: 'writeReplays_return',
    find: `JSON.stringify(e.events ?? []),
        str(r.service, 100), environment, str(r.release, 100),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`,
    replace: `JSON.stringify(e.events ?? []),
        e.traceId ?? null, e.spanId ?? null, e.requestId ?? null, str(r.userId, 255),
        str(r.service, 100), environment, str(r.release, 100),
        str(r.serverName, 100), str(r.applicationName, 100), str(r.applicationVersion, 50),
        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`
  },
  {
    type: 'writeReplays_cols',
    find: `'events', 'service', 'environment', 'release', 'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`,
    replace: `'events', 'trace_id', 'span_id', 'request_id', 'user_id',
       'service', 'environment', 'release', 'server_name', 'application_name', 'application_version', 'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`
  }
];

let failed = false;
for (const { type, find, replace } of replacements) {
  if (content.indexOf(find) === -1) {
    console.error('Failed to find match for ' + type);
    failed = true;
  } else {
    content = content.replace(find, replace);
  }
}

if (!failed) {
  fs.writeFileSync(target, content);
  console.log('Successfully updated telemetry-writer.ts');
}
