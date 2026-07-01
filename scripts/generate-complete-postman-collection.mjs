import fs from 'fs';
import path from 'path';

const root = path.resolve('pulse');
const modules = [
  {
    name: 'Auth',
    key: 'auth',
    prefix: '/auth',
    files: [
      'src/modules/auth/routes.ts',
      'src/modules/auth/account-administration.routes.ts',
      'src/modules/auth/identity.routes.ts',
      'src/modules/auth/provisioning.routes.ts',
      'src/modules/auth/saml-identity.routes.ts',
      'src/modules/auth/sso-oidc.routes.ts',
    ],
  },
  {
    name: 'SCIM',
    key: 'scim',
    prefix: '/scim/v2',
    files: ['src/modules/scim/scim.routes.ts'],
  },
  {
    name: 'Organizations',
    key: 'organizations',
    prefix: '/organizations',
    files: [
      'src/modules/organization/routes.ts',
      'src/modules/organization/sdk-config.routes.ts',
    ],
  },
  {
    name: 'Billing',
    key: 'billing',
    prefix: '/billing',
    files: ['src/modules/billing/routes.ts'],
  },
  {
    name: 'Projects',
    key: 'projects',
    prefix: '/organizations/:orgId/projects',
    files: ['src/modules/projects/routes.ts'],
  },
  {
    name: 'Analytics',
    key: 'analytics',
    prefix: '/analytics',
    files: ['src/modules/analytics/routes.ts'],
  },
  {
    name: 'Ingestion',
    key: 'ingestion',
    prefix: '/api',
    files: ['src/modules/ingestion/routes.ts'],
  },
  {
    name: 'Connectors',
    key: 'connectors',
    prefix: '/organizations/:orgId/connectors',
    files: ['src/modules/connectors/routes.ts'],
  },
  {
    name: 'Alerting',
    key: 'alerting',
    prefix: '/organizations/:orgId/alerting',
    files: ['src/modules/alerting/routes.ts'],
  },
  {
    name: 'Event Analytics',
    key: 'event-analytics',
    prefix: '/organizations/:orgId/analytics',
    files: ['src/modules/event-analytics/routes.ts'],
  },
];

const inactiveRouteFiles = [
  'src/modules/ai/routes.ts',
  'src/modules/webhooks/routes.ts',
];

const existingCollectionPath = path.join(root, 'postman', 'api-monitoring-backend.postman_collection.json');
const outputCollectionPath = path.join(root, 'postman', 'pulse-complete.postman_collection.json');
const outputAnalysisPath = path.join(root, 'postman', 'PULSE_API_ANALYSIS.md');

const routePattern = /fastify\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function parseRoutes(content) {
  const routes = [];
  let match;
  while ((match = routePattern.exec(content)) !== null) {
    routes.push({ method: match[1].toUpperCase(), path: match[2] });
  }
  return routes;
}

function joinPaths(prefix, routePath) {
  const left = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const right = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${left}${right}`.replace(/\/+/g, '/');
}

function pathToPostman(pathname) {
  return pathname.replace(/:([A-Za-z0-9_]+)/g, (_, key) => `{{${key}}}`);
}

function pathSegments(pathname) {
  return pathname.split('/').filter(Boolean).map((segment) => (
    segment.startsWith(':') ? `{{${segment.slice(1)}}}` : segment
  ));
}

function keyFor(method, pathname) {
  return `${method} ${pathname}`;
}

function flattenItems(items, out = []) {
  for (const item of items ?? []) {
    if (item.request) {
      out.push(item);
      continue;
    }
    flattenItems(item.item, out);
  }
  return out;
}

function normalizeRawUrl(raw) {
  return raw.replace('{{baseUrl}}', '').replace(/https?:\/\/[^/]+/, '');
}

function loadExistingLookup() {
  if (!fs.existsSync(existingCollectionPath)) return new Map();
  const collection = JSON.parse(fs.readFileSync(existingCollectionPath, 'utf8'));
  const lookup = new Map();
  for (const item of flattenItems(collection.item)) {
    const request = item.request;
    const raw = typeof request.url === 'string' ? request.url : request.url?.raw;
    if (!raw) continue;
    lookup.set(keyFor(request.method, normalizeRawUrl(raw)), JSON.parse(JSON.stringify(item)));
  }
  return lookup;
}

function bearerAuth(token = '{{accessToken}}') {
  return {
    type: 'bearer',
    bearer: [{ key: 'token', value: token, type: 'string' }],
  };
}

function buildUrl(pathname, query = []) {
  const rawBase = `{{baseUrl}}${pathToPostman(pathname)}`;
  const rawQuery = query.length
    ? `?${query.map((entry) => `${entry.key}=${entry.value}`).join('&')}`
    : '';
  return {
    raw: `${rawBase}${rawQuery}`,
    host: ['{{baseUrl}}'],
    path: pathSegments(pathname),
    query,
  };
}

function jsonBody(example) {
  return {
    mode: 'raw',
    raw: JSON.stringify(example, null, 2),
    options: { raw: { language: 'json' } },
  };
}

function isIngestionApiKeyRoute(pathname) {
  return [
    '/api/v1/init',
    '/api/v1/ingest',
    '/api/v1/ingest/requests',
    '/api/v1/ingest/errors',
    '/api/v1/ingest/logs',
    '/api/v1/ingest/metrics',
    '/api/v1/limits',
  ].includes(pathname);
}

const collectionTestScript = [
  'const contentType = (pm.response.headers.get("Content-Type") || "").toLowerCase();',
  'if (!contentType.includes("application/json")) { return; }',
  'let payload;',
  'try { payload = pm.response.json(); } catch (error) { return; }',
  'const data = payload?.data ?? payload;',
  'function setVar(key, value) {',
  '  if (value === undefined || value === null || value === "") return;',
  '  pm.collectionVariables.set(key, String(value));',
  '}',
  'function pick(obj, keys) {',
  '  if (!obj || typeof obj !== "object") return undefined;',
  '  for (const key of keys) {',
  '    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];',
  '  }',
  '}',
  'const scopes = [payload, data, data?.user, data?.session, data?.organization, data?.project, data?.apiKey, data?.connector];',
  'for (const scope of scopes) {',
  '  setVar("accessToken", pick(scope, ["access_token", "accessToken", "token"]));',
  '  setVar("refreshToken", pick(scope, ["refresh_token", "refreshToken"]));',
  '  setVar("sessionId", pick(scope, ["session_id", "sessionId", "id"]));',
  '  setVar("userId", pick(scope, ["user_id", "userId", "id"]));',
  '  setVar("orgId", pick(scope, ["org_id", "orgId", "organization_id", "organizationId", "id"]));',
  '  setVar("projectId", pick(scope, ["project_id", "projectId", "id"]));',
  '  setVar("apiKeyId", pick(scope, ["api_key_id", "apiKeyId", "id"]));',
  '  setVar("connectorId", pick(scope, ["connector_id", "connectorId", "id"]));',
  '  setVar("ruleId", pick(scope, ["rule_id", "ruleId", "id"]));',
  '  setVar("eventId", pick(scope, ["event_id", "eventId", "id"]));',
  '  setVar("dashboardId", pick(scope, ["dashboard_id", "dashboardId", "id"]));',
  '  setVar("savedQueryId", pick(scope, ["saved_query_id", "savedQueryId", "id"]));',
  '  setVar("alertId", pick(scope, ["alert_id", "alertId", "id"]));',
  '  setVar("configId", pick(scope, ["config_id", "configId", "id"]));',
  '  setVar("ssoId", pick(scope, ["sso_id", "ssoId", "id"]));',
  '  setVar("scimTokenId", pick(scope, ["token_id", "tokenId", "id"]));',
  '  setVar("quotaRequestId", pick(scope, ["request_id", "requestId", "id"]));',
  '}',
  'if (data?.rawKey) setVar("projectApiKey", data.rawKey);',
  'if (data?.apiKey) setVar("projectApiKey", data.apiKey);',
  'if (data?.secret) setVar("projectApiKey", data.secret);',
  'if (data?.challenge_id) setVar("mfaChallengeId", data.challenge_id);',
  'if (data?.device_id) setVar("mfaDeviceId", data.device_id);',
  'const setCookie = pm.response.headers.get("Set-Cookie") || "";',
  'const refreshMatch = setCookie.match(/refresh_token=([^;]+)/i);',
  'if (refreshMatch) setVar("refreshTokenCookie", refreshMatch[1]);',
];

function defaultHeaders(moduleKey, pathname) {
  const headers = [];
  if (!pathname.includes('/webhooks/')) {
    headers.push({ key: 'Content-Type', value: 'application/json' });
  }
  if (moduleKey === 'billing' && !pathname.startsWith('/billing/webhooks/')) {
    headers.push({ key: 'x-org-id', value: '{{orgId}}' });
  }
  if (moduleKey === 'ingestion' && isIngestionApiKeyRoute(pathname)) {
    headers.push({ key: 'Authorization', value: 'Bearer {{projectApiKey}}' });
  }
  if (moduleKey === 'scim') {
    headers.push({ key: 'Authorization', value: 'Bearer {{scimToken}}' });
  }
  return headers;
}

function defaultAuth(moduleKey, pathname) {
  if (moduleKey === 'auth') {
    const publicRoutes = [
      '/auth/login',
      '/auth/login/mfa',
      '/auth/login/mfa/switch',
      '/auth/login/social/:provider',
      '/auth/login/social/callback',
      '/auth/forgot-password',
      '/auth/password/forgot',
      '/auth/reset-password',
      '/auth/password/reset',
      '/auth/resend-verification',
      '/auth/verify-email',
      '/auth/verify-email/confirm',
      '/auth/verify-email/token',
      '/auth/register',
      '/auth/users',
      '/auth/sso/providers',
      '/auth/sso/callback',
      '/auth/saml/metadata',
      '/auth/saml/login',
      '/auth/saml/acs',
      '/auth/provisioning/jit',
      '/auth/health',
      '/auth/sessions/refresh',
    ];
    return publicRoutes.includes(pathname) ? { type: 'noauth' } : bearerAuth();
  }
  if (moduleKey === 'scim') return { type: 'noauth' };
  if (moduleKey === 'organizations' && pathname === '/organizations/slug-available/:slug') return { type: 'noauth' };
  if (moduleKey === 'organizations' && pathname === '/organizations/invitations/validate') return { type: 'noauth' };
  if (moduleKey === 'billing' && pathname.startsWith('/billing/webhooks/')) return { type: 'noauth' };
  if (moduleKey === 'ingestion' && isIngestionApiKeyRoute(pathname)) return { type: 'noauth' };
  if (moduleKey === 'ingestion' && pathname === '/api/v1/health') return { type: 'noauth' };
  return bearerAuth();
}

const overrides = {
  'POST /auth/login': {
    body: {
      email: 'jane.doe@example.com',
      password: 'StrongPassw0rd!',
      deviceName: 'Postman Desktop',
      rememberMe: true,
    },
    description: 'Primary login flow. Test script captures access token, session id, user id, and MFA challenge id when present.',
  },
  'POST /auth/login/mfa': {
    body: { challengeId: '{{mfaChallengeId}}', code: '123456' },
  },
  'POST /auth/register': {
    body: {
      email: 'jane.doe@example.com',
      full_name: 'Jane Doe',
      password: 'StrongPassw0rd!',
    },
  },
  'POST /auth/sessions/refresh': {
    description: 'Refreshes the session using the cookie jar. Postman should retain the refresh cookie from login automatically.',
  },
  'POST /organizations': {
    body: { name: 'Acme', slug: 'acme', plan: 'starter' },
  },
  'POST /organizations/:orgId/projects': {
    body: { name: 'Checkout API', slug: 'checkout-api', environment: 'production' },
  },
  'POST /organizations/:orgId/projects/:projectId/api-keys': {
    body: { name: 'Server SDK key', environment: 'production', expiresAt: null },
  },
  'GET /analytics/:projectId/events': {
    query: [
      { key: 'limit', value: '50' },
      { key: 'offset', value: '0' },
      { key: 'type', value: '' },
      { key: 'severity', value: '' },
      { key: 'from', value: '' },
      { key: 'to', value: '' },
    ],
  },
  'GET /analytics/:projectId/requests/overview': {
    query: [{ key: 'range', value: '24h' }],
  },
  'GET /analytics/:projectId/dashboard': {
    query: [{ key: 'range', value: '24h' }],
  },
  'GET /analytics/:projectId/error-groups': {
    query: [
      { key: 'status', value: 'unresolved' },
      { key: 'limit', value: '50' },
      { key: 'offset', value: '0' },
      { key: 'sortBy', value: 'last_seen_at' },
      { key: 'sortOrder', value: 'desc' },
    ],
  },
  'PATCH /analytics/:projectId/error-groups/:fingerprint': {
    body: { priority: 2, isResolved: false, assigneeUserId: '{{userId}}' },
  },
  'POST /analytics/:projectId/error-groups/:fingerprint/resolve': {
    body: { resolvedBy: '{{userId}}' },
  },
  'POST /api/v1/init': {
    body: { sdk: { name: 'node', version: '1.0.0' }, projectId: '{{projectId}}', environment: 'production' },
  },
  'POST /api/v1/ingest': {
    body: [{ type: 'request', timestamp: new Date().toISOString(), route: '/checkout', method: 'GET' }],
  },
  'POST /api/v1/ingest/requests': {
    body: [{ timestamp: new Date().toISOString(), route: '/checkout', method: 'GET', statusCode: 200, durationMs: 42 }],
  },
  'POST /api/v1/ingest/errors': {
    body: [{ timestamp: new Date().toISOString(), message: 'Example error', level: 'error', fingerprint: 'example-fingerprint' }],
  },
  'POST /api/v1/ingest/logs': {
    body: [{ timestamp: new Date().toISOString(), level: 'info', message: 'Example log line' }],
  },
  'POST /api/v1/ingest/metrics': {
    body: [{ timestamp: new Date().toISOString(), name: 'http.server.duration', value: 42.5, unit: 'ms' }],
  },
  'GET /api/v1/limits': {
    query: [],
  },
  'GET /api/v1/usage': {
    query: [
      { key: 'projectId', value: '{{projectId}}' },
      { key: 'from', value: '' },
      { key: 'to', value: '' },
    ],
  },
  'GET /api/v1/errors': {
    query: [
      { key: 'projectId', value: '{{projectId}}' },
      { key: 'limit', value: '50' },
      { key: 'offset', value: '0' },
    ],
  },
  'GET /api/v1/dlq': {
    query: [{ key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
  },
  'POST /api/v1/dlq/reprocess-all': {
    body: { batchSize: 100 },
  },
  'POST /api/v1/replay': {
    body: { projectId: '{{projectId}}', from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z', limit: 1000 },
  },
  'POST /organizations/:orgId/connectors': {
    body: {
      name: 'Slack alerts',
      type: 'slack',
      description: 'Primary incident channel',
      config: { webhookUrl: 'https://hooks.slack.com/services/xxx/yyy/zzz', channel: '#alerts' },
      rateLimitRequests: 30,
      rateLimitWindowSeconds: 60,
      maxRetries: 3,
    },
  },
  'PATCH /organizations/:orgId/connectors/:id': {
    body: { description: 'Updated connector description', maxRetries: 5 },
  },
  'GET /organizations/:orgId/connectors': {
    query: [
      { key: 'type', value: '' },
      { key: 'status', value: '' },
      { key: 'search', value: '' },
      { key: 'limit', value: '25' },
      { key: 'offset', value: '0' },
    ],
  },
  'POST /organizations/:orgId/connectors/:id/send': {
    body: {
      notificationType: 'test',
      severity: 'info',
      title: 'Test notification',
      body: 'This is a test notification from Postman.',
      fields: [{ label: 'service', value: 'checkout-api', short: true }],
    },
  },
  'GET /organizations/:orgId/connectors/:id/deliveries': {
    query: [{ key: 'limit', value: '25' }, { key: 'offset', value: '0' }],
  },
  'POST /organizations/:orgId/alerting/rules': {
    body: {
      name: 'High error rate',
      severity: 'critical',
      evaluationIntervalSeconds: 60,
      cooldownSeconds: 300,
      conditions: [{ fieldPath: 'errors.rate', operator: 'gt', thresholdValue: 5 }],
      actions: [{ actionType: 'notify', connectorId: '{{connectorId}}' }],
    },
  },
  'PATCH /organizations/:orgId/alerting/rules/:id': {
    body: { enabled: true, cooldownSeconds: 600 },
  },
  'GET /organizations/:orgId/alerting/rules': {
    query: [
      { key: 'enabled', value: 'true' },
      { key: 'severity', value: '' },
      { key: 'search', value: '' },
      { key: 'limit', value: '50' },
      { key: 'offset', value: '0' },
    ],
  },
  'POST /organizations/:orgId/alerting/rules/:id/test': {
    body: { payload: { errors: { rate: 9 }, service: 'checkout-api' } },
  },
  'POST /organizations/:orgId/alerting/events': {
    body: {
      severity: 'warning',
      source: 'checkout-api',
      payload: { message: 'Latency threshold exceeded' },
      labels: { service: 'checkout-api', env: 'production' },
    },
  },
  'GET /organizations/:orgId/alerting/events': {
    query: [
      { key: 'status', value: '' },
      { key: 'severity', value: '' },
      { key: 'source', value: '' },
      { key: 'ruleId', value: '' },
      { key: 'limit', value: '50' },
      { key: 'offset', value: '0' },
    ],
  },
  'POST /organizations/:orgId/alerting/events/:id/acknowledge': {
    body: { comment: 'Acknowledged from Postman', expiresInMinutes: 60 },
  },
  'POST /organizations/:orgId/alerting/events/:id/resolve': {
    body: { reason: 'manual', comment: 'Resolved from Postman' },
  },
  'POST /organizations/:orgId/alerting/events/:id/silence': {
    body: { durationMinutes: 60, comment: 'Mute noisy event' },
  },
  'POST /organizations/:orgId/alerting/silences': {
    body: {
      comment: 'Scheduled maintenance',
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-07-01T02:00:00.000Z',
      matchers: { service: 'checkout-api' },
    },
  },
  'GET /organizations/:orgId/alerting/silences': {
    query: [{ key: 'active', value: 'true' }, { key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
  },
  'POST /organizations/:orgId/alerting/escalation-policies': {
    body: { name: 'Primary on-call', repeatIntervalMinutes: 15, maxRepeats: 3, isActive: true },
  },
  'PUT /organizations/:orgId/alerting/escalation-policies/:id/steps': {
    body: { stepNumber: 1, waitMinutes: 5, connectorIds: ['{{connectorId}}'], notifyOnCall: false, isActive: true },
  },
  'POST /organizations/:orgId/alerting/templates': {
    body: {
      name: 'Default critical alert',
      templateType: 'body',
      content: 'Critical alert: {{payload.message}}',
      connectorType: 'slack',
    },
  },
  'POST /organizations/:orgId/alerting/templates/:id/preview': {
    body: { sampleData: { payload: { message: 'Preview alert' } } },
  },
  'POST /organizations/:orgId/alerting/routing-rules': {
    body: {
      name: 'Critical to Slack',
      priority: 100,
      conditions: { severity: ['critical'] },
      targetConnectorIds: ['{{connectorId}}'],
    },
  },
  'POST /organizations/:orgId/alerting/routing-rules/test': {
    body: { severity: 'critical', source: 'checkout-api', labels: { env: 'production' } },
  },
  'GET /organizations/:orgId/alerting/metrics': {
    query: [
      { key: 'metricType', value: '' },
      { key: 'ruleId', value: '' },
      { key: 'granularity', value: 'hour' },
      { key: 'from', value: '' },
      { key: 'to', value: '' },
      { key: 'limit', value: '168' },
    ],
  },
  'GET /organizations/:orgId/analytics/overview': {
    query: [{ key: 'range', value: '24h' }, { key: 'projectId', value: '{{projectId}}' }],
  },
  'GET /organizations/:orgId/analytics/trends': {
    query: [{ key: 'range', value: '24h' }, { key: 'granularity', value: 'hour' }, { key: 'projectId', value: '{{projectId}}' }],
  },
  'GET /organizations/:orgId/analytics/errors': {
    query: [
      { key: 'range', value: '24h' },
      { key: 'projectId', value: '{{projectId}}' },
      { key: 'severity', value: '' },
      { key: 'service', value: '' },
      { key: 'search', value: '' },
      { key: 'limit', value: '50' },
      { key: 'offset', value: '0' },
    ],
  },
  'GET /organizations/:orgId/analytics/errors/groups': {
    query: [
      { key: 'projectId', value: '{{projectId}}' },
      { key: 'status', value: 'unresolved' },
      { key: 'search', value: '' },
      { key: 'limit', value: '50' },
      { key: 'offset', value: '0' },
    ],
  },
  'POST /organizations/:orgId/analytics/errors/groups/:fingerprint/resolve': {
    body: { actorId: '{{userId}}' },
  },
  'POST /organizations/:orgId/analytics/errors/groups/:fingerprint/ignore': {
    body: { actorId: '{{userId}}' },
  },
  'GET /organizations/:orgId/analytics/performance/routes': {
    query: [{ key: 'projectId', value: '{{projectId}}' }, { key: 'days', value: '7' }, { key: 'limit', value: '100' }],
  },
  'GET /organizations/:orgId/analytics/performance/distribution': {
    query: [{ key: 'range', value: '24h' }, { key: 'projectId', value: '{{projectId}}' }],
  },
  'GET /organizations/:orgId/analytics/performance/apdex': {
    query: [{ key: 'range', value: '24h' }, { key: 'projectId', value: '{{projectId}}' }],
  },
  'GET /organizations/:orgId/analytics/requests': {
    query: [
      { key: 'range', value: '24h' },
      { key: 'projectId', value: '{{projectId}}' },
      { key: 'method', value: '' },
      { key: 'statusCode', value: '' },
      { key: 'route', value: '' },
      { key: 'slowOnly', value: '' },
      { key: 'errorOnly', value: '' },
      { key: 'limit', value: '50' },
      { key: 'offset', value: '0' },
    ],
  },
  'GET /organizations/:orgId/analytics/traces': {
    query: [{ key: 'range', value: '24h' }, { key: 'projectId', value: '{{projectId}}' }, { key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
  },
  'GET /organizations/:orgId/analytics/metrics/:name': {
    query: [{ key: 'range', value: '24h' }, { key: 'granularity', value: 'hour' }, { key: 'aggregate', value: 'avg' }, { key: 'projectId', value: '{{projectId}}' }],
  },
  'GET /organizations/:orgId/analytics/logs': {
    query: [
      { key: 'range', value: '24h' },
      { key: 'projectId', value: '{{projectId}}' },
      { key: 'level', value: '' },
      { key: 'search', value: '' },
      { key: 'limit', value: '50' },
      { key: 'offset', value: '0' },
    ],
  },
  'GET /organizations/:orgId/analytics/sessions': {
    query: [
      { key: 'range', value: '24h' },
      { key: 'projectId', value: '{{projectId}}' },
      { key: 'userId', value: '' },
      { key: 'crashedOnly', value: '' },
      { key: 'limit', value: '50' },
      { key: 'offset', value: '0' },
    ],
  },
  'GET /organizations/:orgId/analytics/users': {
    query: [{ key: 'range', value: '24h' }, { key: 'projectId', value: '{{projectId}}' }, { key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
  },
  'GET /organizations/:orgId/analytics/crons/:slug/history': {
    query: [{ key: 'projectId', value: '{{projectId}}' }, { key: 'limit', value: '50' }, { key: 'offset', value: '0' }],
  },
  'GET /organizations/:orgId/analytics/live/errors': {
    query: [{ key: 'range', value: '24h' }, { key: 'projectId', value: '{{projectId}}' }],
  },
  'POST /organizations/:orgId/analytics/dashboards': {
    body: {
      projectId: '{{projectId}}',
      name: 'Operations dashboard',
      description: 'Team overview',
      layout: {},
      widgets: [],
      isShared: false,
    },
  },
  'PATCH /organizations/:orgId/analytics/dashboards/:id': {
    body: { name: 'Updated dashboard name', isShared: true },
  },
  'POST /organizations/:orgId/analytics/queries': {
    body: {
      projectId: '{{projectId}}',
      name: 'Errors by route',
      queryType: 'builder',
      queryConfig: { dataset: 'errors' },
      visualizationType: 'table',
    },
  },
  'POST /organizations/:orgId/analytics/queries/:id/execute': {
    body: {},
  },
  'POST /organizations/:orgId/analytics/alerts': {
    body: {
      projectId: '{{projectId}}',
      name: 'High latency',
      metric: 'http.server.duration',
      operator: 'gt',
      threshold: 500,
      windowMinutes: 5,
      notificationChannels: ['{{connectorId}}'],
    },
  },
  'POST /organizations/:orgId/analytics/export': {
    body: { dataset: 'errors', format: 'json', range: '24h', projectId: '{{projectId}}', limit: 1000 },
  },
  'GET /scim/v2/:orgId/Users': {
    query: [{ key: 'startIndex', value: '1' }, { key: 'count', value: '50' }, { key: 'filter', value: '' }],
  },
  'POST /scim/v2/:orgId/Users': {
    body: {
      userName: 'jane.doe@example.com',
      name: { givenName: 'Jane', familyName: 'Doe' },
      emails: [{ value: 'jane.doe@example.com', primary: true }],
      active: true,
    },
  },
  'PUT /scim/v2/:orgId/Users/:id': {
    body: {
      userName: 'jane.doe@example.com',
      name: { givenName: 'Jane', familyName: 'Doe' },
      active: true,
    },
  },
  'PATCH /scim/v2/:orgId/Users/:id': {
    body: {
      Operations: [{ op: 'replace', path: 'active', value: false }],
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
    },
  },
  'GET /organizations/:orgId/sdk-configs': {
    query: [
      { key: 'projectId', value: '{{projectId}}' },
      { key: 'environment', value: 'production' },
      { key: 'configKey', value: '' },
      { key: 'includeInactive', value: 'false' },
    ],
  },
  'POST /organizations/:orgId/sdk-configs': {
    body: {
      configKey: 'feature.checkout.enabled',
      configValue: { enabled: true },
      configType: 'json',
      projectId: '{{projectId}}',
      environment: 'production',
      rolloutPercentage: 100,
      isEncrypted: false,
    },
  },
  'PATCH /organizations/:orgId/sdk-configs/:configId': {
    body: { configValue: { enabled: false }, changeSummary: 'Disable feature flag' },
  },
  'POST /organizations/:orgId/sdk-configs/:configId/rollback': {
    body: { toVersion: 1, reason: 'Rollback from Postman' },
  },
  'GET /organizations/:orgId/sdk-configs/resolve': {
    query: [
      { key: 'projectId', value: '{{projectId}}' },
      { key: 'environment', value: 'production' },
      { key: 'platform', value: 'web' },
      { key: 'sdkVersion', value: '1.0.0' },
    ],
  },
};

function genericExample(pathname, method) {
  if (method === 'GET' || method === 'DELETE') return undefined;
  return {};
}

function buildGeneratedRequest(route, moduleKey) {
  const override = overrides[keyFor(route.method, route.fullPath)] ?? {};
  const query = override.query ?? [];
  const bodyExample = override.body ?? genericExample(route.fullPath, route.method);
  return {
    name: route.fullPath.replace(/^\//, ''),
    request: {
      auth: defaultAuth(moduleKey, route.fullPath),
      method: route.method,
      header: defaultHeaders(moduleKey, route.fullPath),
      ...(bodyExample !== undefined ? { body: jsonBody(bodyExample) } : {}),
      url: buildUrl(route.fullPath, query),
      description: override.description ?? `Generated from ${route.sourceFile}.`,
    },
  };
}

function groupRoutes(routes) {
  const groups = new Map();
  for (const route of routes) {
    const parts = route.fullPath.split('/').filter(Boolean);
    const first = parts[1] ?? parts[0] ?? 'root';
    const folderName = first.startsWith(':') ? 'params' : first;
    if (!groups.has(folderName)) groups.set(folderName, []);
    groups.get(folderName).push(route);
  }
  return [...groups.entries()].map(([name, items]) => ({
    name: name.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
    item: items
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath) || a.method.localeCompare(b.method))
      .map((route) => route.item),
  }));
}

function main() {
  const existingLookup = loadExistingLookup();
  const moduleSummaries = [];
  const collectionItems = [];

  for (const module of modules) {
    const moduleRoutes = [];
    for (const file of module.files) {
      for (const route of parseRoutes(read(file))) {
        const fullPath = joinPaths(module.prefix, route.path);
        const existing = existingLookup.get(keyFor(route.method, fullPath));
        const item = existing
          ? existing
          : buildGeneratedRequest(
              { ...route, fullPath, sourceFile: file },
              module.key,
            );
        moduleRoutes.push({
          ...route,
          fullPath,
          sourceFile: file,
          item,
        });
      }
    }

    const deduped = [...new Map(moduleRoutes.map((route) => [keyFor(route.method, route.fullPath), route])).values()];
    moduleSummaries.push({ ...module, routes: deduped });
    collectionItems.push({
      name: module.name,
      item: groupRoutes(deduped),
    });
  }

  const collection = {
    info: {
      _postman_id: '9bdb66e0-574e-4b7d-9d44-cf0c2934a7be',
      name: 'Pulse Complete API',
      description: 'Complete Postman collection generated from the currently mounted Pulse modules in pulse/src/app.ts. Includes auth/token/id capture helpers and route coverage for auth, scim, organizations, billing, projects, analytics, ingestion, connectors, alerting, and event analytics.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: collectionTestScript,
        },
      },
    ],
    variable: [
      { key: 'baseUrl', value: 'http://localhost:3000' },
      { key: 'accessToken', value: '' },
      { key: 'adminAccessToken', value: '' },
      { key: 'refreshToken', value: '' },
      { key: 'refreshTokenCookie', value: '' },
      { key: 'userId', value: '' },
      { key: 'sessionId', value: '' },
      { key: 'mfaChallengeId', value: '' },
      { key: 'mfaDeviceId', value: '' },
      { key: 'orgId', value: '' },
      { key: 'projectId', value: '' },
      { key: 'projectApiKey', value: '' },
      { key: 'apiKeyId', value: '' },
      { key: 'connectorId', value: '' },
      { key: 'ruleId', value: '' },
      { key: 'eventId', value: '' },
      { key: 'dashboardId', value: '' },
      { key: 'savedQueryId', value: '' },
      { key: 'alertId', value: '' },
      { key: 'configId', value: '' },
      { key: 'ssoId', value: '' },
      { key: 'scimToken', value: '' },
      { key: 'scimTokenId', value: '' },
      { key: 'quotaRequestId', value: '' },
      { key: 'traceId', value: '' },
      { key: 'requestId', value: '' },
      { key: 'errorId', value: '' },
      { key: 'fingerprint', value: '' },
      { key: 'invoiceId', value: '' },
      { key: 'planId', value: 'starter' },
      { key: 'paymentMethodId', value: '' },
      { key: 'provider', value: 'stripe' },
      { key: 'slug', value: 'acme' },
    ],
    item: collectionItems,
  };

  fs.writeFileSync(outputCollectionPath, `${JSON.stringify(collection, null, 2)}\n`, 'utf8');

  const totalRoutes = moduleSummaries.reduce((sum, module) => sum + module.routes.length, 0);
  const analysis = [
    '# Pulse API Analysis',
    '',
    'This file was generated from the mounted modules registered in `pulse/src/app.ts` on 2026-07-01.',
    '',
    '## Active Modules',
    '',
    ...moduleSummaries.flatMap((module) => [
      `### ${module.name}`,
      `- Prefix: \`${module.prefix}\``,
      `- Route files: ${module.files.map((file) => `\`${file}\``).join(', ')}`,
      `- Route count: ${module.routes.length}`,
      '',
    ]),
    `Total active routes discovered: **${totalRoutes}**`,
    '',
    '## Auth Notes',
    '',
    '- `auth` mixes public routes, bearer-protected routes, social login callbacks, and cookie-based session refresh.',
    '- `scim` is mounted separately under `/scim/v2` and typically uses bearer SCIM tokens rather than user access tokens.',
    '- `ingestion` uses project API key auth for `/api/v1/init`, `/api/v1/ingest*`, and `/api/v1/limits`, while operational and replay endpoints use user auth.',
    '- `billing` routes generally require bearer auth plus `x-org-id`, except provider webhooks.',
    '',
    '## Inactive Route Files',
    '',
    ...inactiveRouteFiles.map((file) => `- \`${file}\` exists in the repo but is not mounted by \`pulse/src/app.ts\`, so it is not included in the generated collection.`),
    '',
    '## Collection Output',
    '',
    `- Postman collection: \`pulse/postman/${path.basename(outputCollectionPath)}\``,
    `- Generated from source, with existing request examples reused from \`pulse/postman/${path.basename(existingCollectionPath)}\` when available.`,
    '',
  ].join('\n');

  fs.writeFileSync(outputAnalysisPath, `${analysis}\n`, 'utf8');

  console.log(`Generated ${outputCollectionPath}`);
  console.log(`Generated ${outputAnalysisPath}`);
  console.log(`Total routes: ${totalRoutes}`);
}

main();
