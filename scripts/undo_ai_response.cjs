const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../src/modules/ingestion/pipeline/telemetry-writer.ts');
let content = fs.readFileSync(target, 'utf8');

// Replace return arrays for each method to remove aiResponse
const replacements = [
  {
    type: 'writeErrors',
    find: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`,
    replace: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`
  },
  {
    type: 'events_errors',
    find: `'breadcrumbs', 'tags', 'extra', 'contexts', 'sdk_name', 'sdk_version', 'metadata', 'timestamp',
       'ai_response'],`,
    replace: `'breadcrumbs', 'tags', 'extra', 'contexts', 'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`
  },
  {
    type: 'writeMessages',
    find: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`,
    replace: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`
  },
  {
    type: 'events_messages',
    find: `'tags', 'contexts', 'breadcrumbs', 'sdk_name', 'sdk_version', 'metadata', 'timestamp',
       'ai_response'],`,
    replace: `'tags', 'contexts', 'breadcrumbs', 'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`
  },
  {
    type: 'writeRequests',
    find: `        g.deviceType, g.isBot,
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`,
    replace: `        g.deviceType, g.isBot,
      ];`
  },
  {
    type: 'events_requests',
    find: `'browser_family', 'browser_version_major', 'os_name', 'os_version_major',
       'device_type', 'is_bot', 'ai_response'],`,
    replace: `'browser_family', 'browser_version_major', 'os_name', 'os_version_major',
       'device_type', 'is_bot'],`
  },
  {
    type: 'writeSpans',
    find: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`,
    replace: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`
  },
  {
    type: 'events_spans',
    find: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`,
    replace: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`
  },
  {
    type: 'writeTraces_return',
    find: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`,
    replace: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`
  },
  {
    type: 'writeTraces_cols',
    find: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`,
    replace: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`
  },
  {
    type: 'writeMetrics_return',
    find: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`,
    replace: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`
  },
  {
    type: 'writeMetrics_cols',
    find: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`,
    replace: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`
  },
  {
    type: 'writeLogs_return',
    find: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`,
    replace: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`
  },
  {
    type: 'writeLogs_cols',
    find: `'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`,
    replace: `'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`
  },
  {
    type: 'writeProfiles_return',
    find: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(ts),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`,
    replace: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(ts),
      ];`
  },
  {
    type: 'writeProfiles_cols',
    find: `'profile_data', 'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`,
    replace: `'profile_data', 'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`
  },
  {
    type: 'writeCronCheckins_return',
    find: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`,
    replace: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`
  },
  {
    type: 'writeCronCheckins_cols',
    find: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`,
    replace: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`
  },
  {
    type: 'writeReplays_return',
    find: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
        e.aiResponse != null ? JSON.stringify(e.aiResponse) : null,
      ];`,
    replace: `        str(r.sdkName, 50), str(r.sdkVersion, 50), JSON.stringify({ environment }), iso(resolveTimestamp(event)),
      ];`
  },
  {
    type: 'writeReplays_cols',
    find: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp', 'ai_response'],`,
    replace: `'service', 'environment', 'release', 'server_name', 'application_name', 'application_version',
       'sdk_name', 'sdk_version', 'metadata', 'timestamp'],`
  }
];

content = content.replace(/\r\n/g, '\n');

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
  console.log('Successfully updated telemetry-writer.ts to remove aiResponse');
}
