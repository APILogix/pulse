import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const MODULES_DIR = path.join(SRC_DIR, 'modules');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'backend-module-flows.html');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const MAX_FLOW_DEPTH = 4;
const MAX_CHILDREN_PER_NODE = 8;

const MODULE_CONFIG = {
  auth: {
    label: 'Auth',
    prefixes: ['/auth'],
    routeFiles: ['src/modules/auth/routes.ts', 'src/modules/auth/identity.routes.ts', 'src/modules/auth/sso-oidc.routes.ts', 'src/modules/auth/account-administration.routes.ts', 'src/modules/auth/saml-identity.routes.ts', 'src/modules/auth/provisioning.routes.ts'],
    serviceFiles: ['src/modules/auth/service.ts', 'src/modules/auth/identity.service.ts', 'src/modules/auth/sso.service.ts', 'src/modules/auth/social-login.service.ts', 'src/modules/auth/saml.service.ts', 'src/modules/auth/sso-session.service.ts', 'src/modules/auth/sso-provision.service.ts', 'src/modules/auth/trusted-device.service.ts', 'src/modules/auth/webauthn.service.ts', 'src/modules/auth/policy.service.ts', 'src/modules/auth/identity-link.service.ts'],
    repositoryFiles: ['src/modules/auth/repository.ts'],
  },
  scim: {
    label: 'SCIM',
    prefixes: ['/scim/v2'],
    routeFiles: ['src/modules/scim/scim.routes.ts'],
    serviceFiles: ['src/modules/scim/scim.service.ts'],
    repositoryFiles: ['src/modules/auth/repository.ts'],
  },
  organization: {
    label: 'Organization',
    prefixes: ['/organizations'],
    routeFiles: ['src/modules/organization/routes.ts', 'src/modules/organization/sdk-config.routes.ts'],
    serviceFiles: ['src/modules/organization/organizationservice.ts', 'src/modules/organization/sdk-config.service.ts'],
    repositoryFiles: ['src/modules/organization/repository.ts', 'src/modules/organization/sdk-config.repository.ts'],
  },
  billing: {
    label: 'Billing',
    prefixes: ['/billing'],
    routeFiles: ['src/modules/billing/routes.ts'],
    serviceFiles: ['src/modules/billing/billing.service.ts', 'src/modules/billing/quota-service.ts'],
    repositoryFiles: ['src/modules/billing/repository.ts'],
  },
  ingestion: {
    label: 'Ingestion',
    prefixes: ['/api'],
    routeFiles: ['src/modules/ingestion/routes.ts'],
    serviceFiles: ['src/modules/ingestion/controller.ts', 'src/modules/ingestion/service.ts'],
    repositoryFiles: ['src/modules/ingestion/pipeline/ingestion-job-handler.ts', 'src/modules/ingestion/pipeline/event-normalizer.ts', 'src/modules/ingestion/pipeline/telemetry-reader.ts', 'src/modules/ingestion/pipeline/telemetry-writer.ts', 'src/modules/ingestion/postgress.writter.ts'],
  },
  analytics: {
    label: 'Analytics',
    prefixes: ['/analytics'],
    routeFiles: ['src/modules/analytics/routes.ts'],
    serviceFiles: ['src/modules/analytics/service.ts'],
    repositoryFiles: ['src/modules/analytics/repository.ts'],
  },
  projects: {
    label: 'Projects',
    prefixes: ['/organizations/:orgId/projects'],
    routeFiles: ['src/modules/projects/routes.ts'],
    serviceFiles: ['src/modules/projects/service.ts'],
    repositoryFiles: ['src/modules/projects/repository.ts'],
  },
  connectors: {
    label: 'Connectors',
    prefixes: ['/organizations/:orgId/connectors'],
    routeFiles: ['src/modules/connectors/routes.ts'],
    serviceFiles: ['src/modules/connectors/service.ts', 'src/modules/connectors/dispatcher.ts', 'src/modules/connectors/runtime.ts'],
    repositoryFiles: ['src/modules/connectors/repository.ts'],
  },
  alerting: {
    label: 'Alerting',
    prefixes: ['/organizations/:orgId/alerting'],
    routeFiles: ['src/modules/alerting/routes.ts'],
    serviceFiles: ['src/modules/alerting/service.ts', 'src/modules/alerting/notifier.ts', 'src/modules/alerting/evaluator.ts', 'src/modules/alerting/routing.ts'],
    repositoryFiles: ['src/modules/alerting/repository.ts'],
  },
  'event-analytics': {
    label: 'Event Analytics',
    prefixes: ['/organizations/:orgId/analytics'],
    routeFiles: ['src/modules/event-analytics/routes.ts'],
    serviceFiles: ['src/modules/event-analytics/service.ts', 'src/modules/event-analytics/waterfall.ts'],
    repositoryFiles: ['src/modules/event-analytics/repository.ts'],
  },
};

const allSourceFiles = walkDir(SRC_DIR).filter((file) => file.endsWith('.ts'));
const program = ts.createProgram(allSourceFiles, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  allowJs: false,
  skipLibCheck: true,
});

const sourceFileMap = new Map();
const normalizedSrcDir = normalizeAbs(SRC_DIR).toLowerCase();
for (const sourceFile of program.getSourceFiles()) {
  const normalizedName = normalizeAbs(sourceFile.fileName);
  if (!sourceFile.isDeclarationFile && normalizedName.toLowerCase().startsWith(normalizedSrcDir)) {
    sourceFileMap.set(normalizedName, sourceFile);
  }
}

const declarationIndex = buildDeclarationIndex();
const moduleDocs = Object.entries(MODULE_CONFIG).map(([moduleKey, config]) => buildModuleDoc(moduleKey, config));
const authJourneys = buildAuthJourneys();

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, buildHtml({ generatedAt: new Date().toISOString(), moduleDocs, authJourneys }), 'utf8');
console.log(`Generated ${OUTPUT_PATH}`);

function buildModuleDoc(moduleKey, config) {
  const routes = [];
  for (const routeFile of config.routeFiles) {
    const sourceFile = getSourceFile(routeFile);
    if (!sourceFile) continue;
    routes.push(...extractRoutesFromFile(moduleKey, config, sourceFile));
  }
  return {
    key: moduleKey,
    label: config.label,
    prefixes: config.prefixes,
    routeCount: routes.length,
    routes: routes.sort((a, b) => a.fullPath.localeCompare(b.fullPath) || a.method.localeCompare(b.method)),
  };
}

function extractRoutesFromFile(moduleKey, config, sourceFile) {
  const routes = [];
  const scopeVars = collectVariableDeclarations(sourceFile);

  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const expr = node.expression;
    if (!ts.isPropertyAccessExpression(expr)) return;
    if (expr.expression.getText(sourceFile) !== 'fastify') return;
    const methodName = expr.name.getText(sourceFile);
    if (!HTTP_METHODS.has(methodName)) return;

    const args = node.arguments;
    if (!args.length) return;

    const pathArg = args[0];
    const routePath = literalText(pathArg, sourceFile);
    if (!routePath) return;

    const optionsArg = args[1] && isRouteOptionsArg(args[1]) ? args[1] : null;
    const handlerArg = args[2] ?? (optionsArg ? null : args[1]);
    const middleware = extractMiddleware(optionsArg, scopeVars, sourceFile);

    const route = {
      id: `${moduleKey}:${methodName.toUpperCase()}:${joinPaths(config.prefixes[0], routePath)}`,
      moduleKey,
      method: methodName.toUpperCase(),
      routePath,
      fullPath: joinPaths(config.prefixes[0], routePath),
      sourceFile: relFromRoot(sourceFile.fileName),
      line: lineOf(sourceFile, node),
      middleware,
      handler: describeHandler(handlerArg, moduleKey, sourceFile),
      flow: analyzeHandler(handlerArg, moduleKey, sourceFile, 0, new Set()),
    };

    routes.push(route);
  });

  return routes;
}

function describeHandler(handlerArg, moduleKey, sourceFile) {
  if (!handlerArg) {
    return { type: 'unknown', label: 'No handler detected' };
  }
  const bound = resolveBoundMethod(handlerArg, sourceFile);
  if (bound) return bound;
  const wrapped = unwrapHandlerExpression(handlerArg);
  if (wrapped) {
    return describeHandler(wrapped, moduleKey, sourceFile);
  }
  if (ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg)) {
    return { type: 'inline', label: 'inline route handler', file: relFromRoot(sourceFile.fileName), line: lineOf(sourceFile, handlerArg) };
  }
  if (ts.isIdentifier(handlerArg)) {
    return { type: 'identifier', label: handlerArg.getText(sourceFile), file: relFromRoot(sourceFile.fileName), line: lineOf(sourceFile, handlerArg) };
  }
  return { type: 'expression', label: shortExpr(handlerArg.getText(sourceFile)), file: relFromRoot(sourceFile.fileName), line: lineOf(sourceFile, handlerArg) };
}

function analyzeHandler(handlerArg, moduleKey, sourceFile, depth, seen) {
  if (!handlerArg) return [simpleNode('handler not detected', sourceFile, null)];
  const directBound = resolveBoundMethod(handlerArg, sourceFile, true);
  if (directBound?.decl) return analyzeDeclaration(directBound.decl, moduleKey, depth, seen);
  const wrapped = unwrapHandlerExpression(handlerArg);
  if (wrapped) return analyzeHandler(wrapped, moduleKey, sourceFile, depth, seen);

  if (ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg)) {
    return analyzeFunctionBody(handlerArg.body, moduleKey, sourceFile, depth, seen, null);
  }

  if (ts.isIdentifier(handlerArg)) {
    const decl = resolveIdentifierDeclaration(handlerArg.getText(sourceFile), sourceFile, moduleKey);
    if (decl) return analyzeDeclaration(decl, moduleKey, depth, seen);
    return [simpleNode(`handler ${handlerArg.getText(sourceFile)}`, sourceFile, handlerArg)];
  }

  return [simpleNode(shortExpr(handlerArg.getText(sourceFile)), sourceFile, handlerArg)];
}

function analyzeDeclaration(decl, moduleKey, depth, seen) {
  const key = `${normalizeAbs(decl.sourceFile.fileName)}::${decl.name}`;
  if (seen.has(key) || depth > MAX_FLOW_DEPTH) {
    return [simpleNode(`${decl.name}()`, decl.sourceFile, decl.node)];
  }

  const nextSeen = new Set(seen);
  nextSeen.add(key);

  const body = getBodyNode(decl.node);
  if (!body) return [simpleNode(`${decl.name}()`, decl.sourceFile, decl.node)];

  return [{
    label: `${decl.name}()`,
    file: relFromRoot(decl.sourceFile.fileName),
    line: lineOf(decl.sourceFile, decl.node),
    children: analyzeFunctionBody(body, moduleKey, decl.sourceFile, depth + 1, nextSeen, decl),
  }];
}

function analyzeFunctionBody(body, moduleKey, sourceFile, depth, seen, currentDecl) {
  const steps = [];
  const statements = ts.isBlock(body) ? body.statements : [body];

  for (const statement of statements) {
    const calls = collectInterestingCalls(statement, sourceFile);
    for (const call of calls.slice(0, MAX_CHILDREN_PER_NODE)) {
      const node = buildFlowNode(call, moduleKey, sourceFile, depth, seen, currentDecl);
      if (node) steps.push(node);
    }
  }

  return compressNodes(steps);
}

function buildFlowNode(call, moduleKey, sourceFile, depth, seen, currentDecl) {
  const text = shortExpr(call.expressionText);
  const label = classifyCallLabel(text);
  const resolved = resolveCallTarget(call.node, moduleKey, sourceFile, currentDecl);
  if (!resolved || depth >= MAX_FLOW_DEPTH) {
    return simpleNode(label, sourceFile, call.node);
  }

  const children = analyzeDeclaration(resolved, moduleKey, depth + 1, seen);
  return {
    label,
    file: relFromRoot(sourceFile.fileName),
    line: lineOf(sourceFile, call.node),
    children,
  };
}

function collectInterestingCalls(node, sourceFile) {
  const calls = [];
  visit(node, (child) => {
    if (!ts.isCallExpression(child)) return;
    const expressionText = child.expression.getText(sourceFile);
    if (shouldIgnoreCall(expressionText)) return;
    calls.push({ node: child, expressionText });
  });
  return uniqueBy(calls, (item) => `${item.expressionText}:${lineOf(sourceFile, item.node)}`);
}

function resolveCallTarget(callNode, moduleKey, sourceFile, currentDecl) {
  const expr = callNode.expression;

  if (ts.isIdentifier(expr)) {
    return resolveIdentifierDeclaration(expr.getText(sourceFile), sourceFile, moduleKey, currentDecl);
  }

  if (ts.isPropertyAccessExpression(expr)) {
    const lhs = expr.expression.getText(sourceFile);
    const rhs = expr.name.getText(sourceFile);

    if (lhs === 'this') {
      if (currentDecl?.className) {
        return findDeclarationByName(moduleKey, rhs, currentDecl.className);
      }
      return resolveIdentifierDeclaration(rhs, sourceFile, moduleKey, currentDecl);
    }

    if (lhs.endsWith('.service') || lhs === 'service' || lhs === 'svc' || lhs.endsWith('Service')) {
      return findDeclarationByName(moduleKey, rhs, null, 'service');
    }
    if (lhs === 'controller' || lhs.endsWith('Controller')) {
      return findDeclarationByName(moduleKey, rhs, 'IngestionController');
    }
    if (lhs.includes('repo') || lhs.endsWith('.repository') || lhs === 'repository') {
      return findDeclarationByName(moduleKey, rhs, null, 'repository');
    }
    if (lhs.includes('sdkConfigService')) {
      return findDeclarationByName('organization', rhs, null, 'service');
    }
    if (lhs.includes('authService')) {
      return findDeclarationByName('auth', rhs, null, 'service');
    }
  }

  return null;
}

function resolveIdentifierDeclaration(name, sourceFile, moduleKey, currentDecl = null) {
  const local = declarationIndex.localByFile.get(normalizeAbs(sourceFile.fileName))?.get(name);
  if (local) return local;
  if (currentDecl?.className) {
    const classScoped = declarationIndex.byModule.get(moduleKey)?.find((entry) => entry.name === name && entry.className === currentDecl.className);
    if (classScoped) return classScoped;
  }
  return findDeclarationByName(moduleKey, name);
}

function findDeclarationByName(moduleKey, name, className = null, lane = null) {
  const entries = declarationIndex.byModule.get(moduleKey) ?? [];
  const filtered = entries.filter((entry) => entry.name === name);
  if (className) {
    const direct = filtered.find((entry) => entry.className === className);
    if (direct) return direct;
  }
  if (lane) {
    const laneMatch = filtered.find((entry) => entry.lane === lane);
    if (laneMatch) return laneMatch;
  }
  return filtered[0] ?? null;
}

function buildDeclarationIndex() {
  const byModule = new Map();
  const localByFile = new Map();

  for (const [moduleKey, config] of Object.entries(MODULE_CONFIG)) {
    const files = [...config.routeFiles, ...config.serviceFiles, ...config.repositoryFiles]
      .map((file) => getSourceFile(file))
      .filter(Boolean);
    const entries = [];

    for (const sourceFile of files) {
      const file = normalizeAbs(sourceFile.fileName);
      const locals = new Map();
      collectDeclarationsFromSourceFile(sourceFile, (entry) => {
        const item = { ...entry, moduleKey };
        entries.push(item);
        if (!locals.has(entry.name)) locals.set(entry.name, item);
      });
      localByFile.set(file, locals);
    }

    byModule.set(moduleKey, entries);
  }

  return { byModule, localByFile };
}

function collectDeclarationsFromSourceFile(sourceFile, push) {
  visit(sourceFile, (node, parentStack) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      push({
        name: node.name.getText(sourceFile),
        node,
        sourceFile,
        className: null,
        lane: laneForFile(sourceFile.fileName),
      });
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (!ts.isArrowFunction(decl.initializer) && !ts.isFunctionExpression(decl.initializer)) continue;
        push({
          name: decl.name.getText(sourceFile),
          node: decl.initializer,
          sourceFile,
          className: null,
          lane: laneForFile(sourceFile.fileName),
        });
      }
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.getText(sourceFile);
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          push({
            name: member.name.getText(sourceFile),
            node: member,
            sourceFile,
            className,
            lane: laneForFile(sourceFile.fileName),
          });
        }
      }
    }
  });
}

function buildAuthJourneys() {
  return [
    {
      id: 'register-verify-login',
      title: 'Signup -> Email Verification -> Login',
      summary: 'Standard password onboarding for a new user. Registration creates the account, verification activates email ownership, then password login may branch into MFA before session issuance.',
      routeRefs: ['POST /auth/register', 'GET /auth/verify-email', 'POST /auth/login', 'POST /auth/login/mfa'],
      steps: [
        'User submits `POST /auth/register`.',
        'Route validates request body and calls `service.registerUser(...)`.',
        'Auth service creates the user record, verification token, audit entries, and email outbox work.',
        'User opens verification link via `GET /auth/verify-email?token=...`.',
        'Route calls `service.verifyEmailToken(...)` and marks the email as verified.',
        'User logs in through `POST /auth/login`.',
        'Route calls `service.loginWithEmailPassword(...)`.',
        'If MFA is required, the client completes `POST /auth/login/mfa` or passkey verification.',
        'Successful auth returns access token, refresh cookie, session data, and user payload.',
      ],
    },
    {
      id: 'password-reset',
      title: 'Forgot Password -> Reset -> Re-authenticate',
      summary: 'Recovery flow for users who cannot log in with their current password.',
      routeRefs: ['POST /auth/password/forgot', 'POST /auth/password/reset', 'POST /auth/login'],
      steps: [
        'User requests reset using `POST /auth/password/forgot`.',
        'Route validates email and calls `service.forgotPassword(...)`.',
        'Service creates a reset token and queues/sends reset email without revealing whether the email exists.',
        'User submits `POST /auth/password/reset` with token and new password.',
        'Route calls `service.resetPassword(...)`.',
        'Service updates password hash, revokes active sessions, rotates related caches, and records audit/security events.',
        'User signs in again with `POST /auth/login` using the new password.',
      ],
    },
    {
      id: 'step-up-sensitive-actions',
      title: 'Session -> Step-up MFA -> Sensitive Route',
      summary: 'Used for password change, account deletion, backup code generation, device removal, and other high-risk actions.',
      routeRefs: ['POST /auth/mfa/challenge', 'POST /auth/mfa/verify', 'POST /auth/password/change', 'DELETE /auth/users/me'],
      steps: [
        'User already has a valid authenticated session.',
        'Sensitive route declares `authenticate` plus `requireStepUp`.',
        'Client starts step-up with `POST /auth/mfa/challenge`.',
        'Route calls service to create a short-lived challenge in the step-up cache.',
        'Client proves possession via `POST /auth/mfa/verify` or WebAuthn verification.',
        'Service marks step-up freshness in the cache for the session.',
        'Original sensitive route is retried.',
        'Route passes `requireStepUp` and executes the protected service method.',
      ],
    },
    {
      id: 'enterprise-sso',
      title: 'Discovery -> SSO Redirect -> Callback -> Session',
      summary: 'Enterprise sign-in path for OIDC/SAML orgs and social login variants.',
      routeRefs: ['GET /auth/sso/discovery', 'POST /auth/sso/login', 'GET /auth/sso/callback', 'GET /auth/login/social/callback'],
      steps: [
        'Client calls `GET /auth/sso/discovery?email=...` to determine available auth methods.',
        'Route returns whether password login, OIDC, SAML, or social login should be offered.',
        'Client starts `POST /auth/sso/login` or provider-specific social login.',
        'Service stores state/PKCE metadata, then redirects the browser to the external IdP.',
        'IdP redirects back to callback route with code/state or SAML response.',
        'Callback route validates state, exchanges credentials/assertion, provisions membership when allowed, and checks org policy.',
        'Service issues application session and sends the normal auth response payload.',
      ],
    },
  ];
}

function buildHtml(payload) {
  const data = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Backend Module Flows</title>
  <style>
    :root {
      --bg: #09121a;
      --panel: #0f1e29;
      --panel-2: #132633;
      --border: #284052;
      --text: #e9f2f7;
      --muted: #9bb2c2;
      --accent: #57d6a4;
      --accent-2: #5bc0ff;
      --warn: #ffd580;
      --code: #0a1720;
      --route: #1b3343;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "IBM Plex Sans", sans-serif;
      background:
        radial-gradient(circle at top right, rgba(91,192,255,0.12), transparent 24%),
        radial-gradient(circle at bottom left, rgba(87,214,164,0.10), transparent 30%),
        var(--bg);
      color: var(--text);
    }
    .layout {
      display: grid;
      grid-template-columns: 300px 360px minmax(0, 1fr);
      min-height: 100vh;
    }
    .sidebar, .route-list, .content {
      border-right: 1px solid var(--border);
      overflow: auto;
    }
    .sidebar { background: rgba(7, 15, 22, 0.92); }
    .route-list { background: rgba(10, 19, 27, 0.94); }
    .content { background: rgba(9, 18, 26, 0.96); border-right: 0; }
    .panel-pad { padding: 20px; }
    h1, h2, h3 { margin: 0; }
    .eyebrow {
      color: var(--accent);
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .muted { color: var(--muted); }
    .module-btn, .route-btn, .journey-btn {
      width: 100%;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text);
      text-align: left;
      padding: 12px 14px;
      cursor: pointer;
      border-radius: 12px;
      transition: 120ms ease;
      display: block;
    }
    .module-btn:hover, .route-btn:hover, .journey-btn:hover { background: rgba(255,255,255,0.04); }
    .module-btn.active, .route-btn.active, .journey-btn.active {
      background: linear-gradient(135deg, rgba(87,214,164,0.18), rgba(91,192,255,0.12));
      border-color: rgba(87,214,164,0.30);
    }
    .module-meta, .route-meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 4px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(87,214,164,0.12);
      color: var(--accent);
      border: 1px solid rgba(87,214,164,0.25);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      margin-right: 8px;
      margin-bottom: 8px;
    }
    .route-card, .meta-card {
      border: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(19,38,51,0.92), rgba(11,24,33,0.96));
      border-radius: 16px;
      padding: 18px;
      margin-bottom: 16px;
    }
    .code {
      font-family: "Consolas", "JetBrains Mono", monospace;
      background: var(--code);
      border: 1px solid rgba(255,255,255,0.08);
      padding: 3px 7px;
      border-radius: 8px;
      font-size: 13px;
      color: #d7f1ff;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .meta-grid > div {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 12px;
    }
    .section-title { margin-bottom: 12px; }
    .flow-wrap {
      overflow: auto;
      background: rgba(3, 10, 15, 0.45);
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.06);
      padding: 12px;
    }
    svg { width: 100%; min-height: 320px; }
    .list { margin: 0; padding-left: 18px; }
    .list li { margin-bottom: 8px; color: var(--muted); }
    .sticky-head {
      position: sticky;
      top: 0;
      background: inherit;
      z-index: 2;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      backdrop-filter: blur(8px);
    }
    .search {
      width: 100%;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.04);
      color: var(--text);
      outline: none;
    }
    @media (max-width: 1200px) {
      .layout { grid-template-columns: 260px 300px minmax(0, 1fr); }
    }
    @media (max-width: 980px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar, .route-list, .content { border-right: 0; border-bottom: 1px solid var(--border); }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sticky-head panel-pad">
        <div class="eyebrow">Backend Map</div>
        <h1 style="margin-top:8px;font-size:28px;">Module Flow Explorer</h1>
        <p class="muted" style="margin:10px 0 0;">Generated from backend source. Click a module, then a route, to inspect middleware and downstream call flow.</p>
        <p class="muted" style="font-size:12px;margin-top:10px;">Generated: ${escapeHtml(payload.generatedAt)}</p>
      </div>
      <div class="panel-pad">
        <input id="moduleSearch" class="search" placeholder="Filter modules or routes" />
      </div>
      <div id="moduleNav" class="panel-pad" style="padding-top:0;"></div>
    </aside>
    <section class="route-list">
      <div id="routePanel"></div>
    </section>
    <main class="content">
      <div id="detailPanel" class="panel-pad"></div>
    </main>
  </div>
  <script>
    const payload = ${data};
    const moduleNav = document.getElementById('moduleNav');
    const routePanel = document.getElementById('routePanel');
    const detailPanel = document.getElementById('detailPanel');
    const moduleSearch = document.getElementById('moduleSearch');

    let activeModule = payload.moduleDocs[0]?.key || null;
    let activeRoute = payload.moduleDocs[0]?.routes[0]?.id || null;
    let searchText = '';

    function render() {
      renderModules();
      renderRoutes();
      renderDetails();
    }

    function renderModules() {
      const cards = payload.moduleDocs.filter((mod) => matchesModule(mod)).map((mod) => {
        const active = mod.key === activeModule ? 'active' : '';
        return \`
          <button class="module-btn \${active}" data-module="\${mod.key}">
            <strong>\${escapeHtml(mod.label)}</strong>
            <div class="module-meta">\${mod.routeCount} routes</div>
            <div class="module-meta">\${mod.prefixes.map(escapeHtml).join(' , ')}</div>
          </button>
        \`;
      }).join('');
      moduleNav.innerHTML = cards;
      moduleNav.querySelectorAll('[data-module]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeModule = btn.dataset.module;
          const mod = payload.moduleDocs.find((item) => item.key === activeModule);
          activeRoute = mod?.routes[0]?.id || null;
          render();
        });
      });
    }

    function renderRoutes() {
      const mod = payload.moduleDocs.find((item) => item.key === activeModule);
      if (!mod) {
        routePanel.innerHTML = '<div class="panel-pad"><p class="muted">No module selected.</p></div>';
        return;
      }

      const routes = mod.routes.filter((route) => matchesRoute(route));
      if (!routes.find((route) => route.id === activeRoute)) {
        activeRoute = routes[0]?.id || null;
      }

      routePanel.innerHTML = \`
        <div class="sticky-head panel-pad">
          <div class="eyebrow">\${escapeHtml(mod.label)}</div>
          <h2 style="margin-top:8px;">Routes</h2>
          <p class="muted" style="margin-top:10px;">\${routes.length} route entries</p>
        </div>
        <div class="panel-pad">
          \${routes.map((route) => \`
            <button class="route-btn \${route.id === activeRoute ? 'active' : ''}" data-route="\${route.id}">
              <div><span class="code">\${route.method}</span> <span style="margin-left:8px;">\${escapeHtml(route.fullPath)}</span></div>
              <div class="route-meta">\${route.middleware.join(', ') || 'No explicit middleware'} </div>
            </button>
          \`).join('')}
          \${mod.key === 'auth' ? \`
            <div style="height:1px;background:rgba(255,255,255,0.08);margin:18px 0;"></div>
            <div class="eyebrow">Cross-route journeys</div>
            <div style="margin-top:10px;">
              \${payload.authJourneys.map((journey, index) => \`
                <button class="journey-btn" data-journey="\${journey.id}">
                  <strong>\${index + 1}. \${escapeHtml(journey.title)}</strong>
                  <div class="route-meta">\${escapeHtml(journey.summary)}</div>
                </button>
              \`).join('')}
            </div>
          \` : ''}
        </div>
      \`;

      routePanel.querySelectorAll('[data-route]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeRoute = btn.dataset.route;
          renderDetails();
          renderRoutes();
        });
      });
      routePanel.querySelectorAll('[data-journey]').forEach((btn) => {
        btn.addEventListener('click', () => renderJourney(btn.dataset.journey));
      });
    }

    function renderDetails() {
      const mod = payload.moduleDocs.find((item) => item.key === activeModule);
      const route = mod?.routes.find((item) => item.id === activeRoute);
      if (!route) {
        detailPanel.innerHTML = '<p class="muted">Select a route to inspect its flow.</p>';
        return;
      }

      detailPanel.innerHTML = \`
        <div class="route-card">
          <div class="eyebrow">\${escapeHtml(mod.label)}</div>
          <h2 style="margin-top:8px;"><span class="code">\${route.method}</span> \${escapeHtml(route.fullPath)}</h2>
          <p class="muted" style="margin-top:10px;">Source: \${escapeHtml(route.sourceFile)}:\${route.line}</p>
          <div style="margin-top:14px;">
            \${route.middleware.map((item) => \`<span class="pill">\${escapeHtml(item)}</span>\`).join('') || '<span class="pill">No explicit middleware</span>'}
          </div>
        </div>

        <div class="meta-card">
          <h3 class="section-title">Route Metadata</h3>
          <div class="meta-grid">
            <div>
              <div class="muted">Handler</div>
              <div style="margin-top:6px;">\${escapeHtml(route.handler.label)}</div>
            </div>
            <div>
              <div class="muted">Mounted Path</div>
              <div style="margin-top:6px;">\${escapeHtml(route.routePath)}</div>
            </div>
            <div>
              <div class="muted">Module Prefix</div>
              <div style="margin-top:6px;">\${escapeHtml(mod.prefixes[0])}</div>
            </div>
            <div>
              <div class="muted">Flow Depth</div>
              <div style="margin-top:6px;">Up to nested service/repository calls</div>
            </div>
          </div>
        </div>

        <div class="meta-card">
          <h3 class="section-title">Execution Flow</h3>
          <div class="flow-wrap">
            <div id="flowSvgHost"></div>
          </div>
        </div>

        <div class="meta-card">
          <h3 class="section-title">Flattened Call Sequence</h3>
          <ol class="list">\${flattenFlow(route.flow).map((step) => \`<li><span class="code">\${escapeHtml(step.label)}</span> <span class="muted">(\${escapeHtml(step.file || 'n/a')}\${step.line ? ':' + step.line : ''})</span></li>\`).join('')}</ol>
        </div>
      \`;

      const host = document.getElementById('flowSvgHost');
      host.innerHTML = renderSvg(route.flow);
    }

    function renderJourney(journeyId) {
      const journey = payload.authJourneys.find((item) => item.id === journeyId);
      if (!journey) return;
      detailPanel.innerHTML = \`
        <div class="route-card">
          <div class="eyebrow">Auth Journey</div>
          <h2 style="margin-top:8px;">\${escapeHtml(journey.title)}</h2>
          <p class="muted" style="margin-top:10px;">\${escapeHtml(journey.summary)}</p>
          <div style="margin-top:14px;">\${journey.routeRefs.map((item) => \`<span class="pill">\${escapeHtml(item)}</span>\`).join('')}</div>
        </div>
        <div class="meta-card">
          <h3 class="section-title">Journey Diagram</h3>
          <div class="flow-wrap">\${renderSvg(journey.steps.map((step) => ({ label: step, file: 'auth journey', line: null, children: [] })))}</div>
        </div>
        <div class="meta-card">
          <h3 class="section-title">Step-by-step</h3>
          <ol class="list">\${journey.steps.map((step) => \`<li>\${escapeHtml(step)}</li>\`).join('')}</ol>
        </div>
      \`;
    }

    function flattenFlow(flow) {
      const out = [];
      function walk(nodes) {
        nodes.forEach((node) => {
          out.push(node);
          if (node.children?.length) walk(node.children);
        });
      }
      walk(flow || []);
      return out;
    }

    function renderSvg(flow) {
      const nodes = [];
      let y = 24;
      function walk(items, depth) {
        items.forEach((item) => {
          const width = 300;
          const x = 24 + depth * 44;
          const height = 56;
          const current = { x, y, width, height, label: item.label, meta: (item.file || '') + (item.line ? ':' + item.line : '') };
          nodes.push(current);
          const startY = y;
          y += height + 26;
          if (item.children?.length) {
            const parentIndex = nodes.length - 1;
            walk(item.children, depth + 1);
            current.childRange = [parentIndex + 1, nodes.length - 1];
            current.startY = startY;
          }
        });
      }
      walk(flow || [], 0);
      const svgHeight = Math.max(y + 10, 340);
      const svgWidth = 1100;

      let connectors = '';
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        connectors += \`<path d="M \${a.x + a.width} \${a.y + a.height / 2} C \${a.x + a.width + 30} \${a.y + a.height / 2}, \${b.x - 30} \${b.y + b.height / 2}, \${b.x} \${b.y + b.height / 2}" stroke="rgba(91,192,255,0.6)" stroke-width="2" fill="none" />\`;
      }

      const rects = nodes.map((node, index) => \`
        <g>
          <rect x="\${node.x}" y="\${node.y}" rx="14" ry="14" width="\${node.width}" height="\${node.height}" fill="\${index % 2 ? 'rgba(20,45,59,0.96)' : 'rgba(15,35,47,0.96)'}" stroke="rgba(87,214,164,0.35)" />
          <text x="\${node.x + 14}" y="\${node.y + 23}" fill="#e9f2f7" font-size="13" font-family="Segoe UI, sans-serif">\${escapeHtml(node.label).slice(0, 58)}</text>
          <text x="\${node.x + 14}" y="\${node.y + 42}" fill="#9bb2c2" font-size="11" font-family="Consolas, monospace">\${escapeHtml(node.meta).slice(0, 58)}</text>
        </g>
      \`).join('');

      return \`<svg viewBox="0 0 \${svgWidth} \${svgHeight}" xmlns="http://www.w3.org/2000/svg">\${connectors}\${rects}</svg>\`;
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
    }

    function matchesModule(mod) {
      if (!searchText) return true;
      const haystack = [mod.label, ...mod.prefixes, ...mod.routes.map((route) => route.fullPath)].join(' ').toLowerCase();
      return haystack.includes(searchText);
    }

    function matchesRoute(route) {
      if (!searchText) return true;
      const haystack = [route.method, route.fullPath, route.middleware.join(' '), route.sourceFile].join(' ').toLowerCase();
      return haystack.includes(searchText);
    }

    moduleSearch.addEventListener('input', (event) => {
      searchText = event.target.value.trim().toLowerCase();
      render();
    });

    render();
  </script>
</body>
</html>`;
}

function collectVariableDeclarations(sourceFile) {
  const vars = new Map();
  visit(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
    vars.set(node.name.getText(sourceFile), node.initializer);
  });
  return vars;
}

function extractMiddleware(optionsArg, scopeVars, sourceFile) {
  if (!optionsArg) return [];
  let node = optionsArg;
  if (ts.isIdentifier(optionsArg) && scopeVars.has(optionsArg.getText(sourceFile))) {
    node = scopeVars.get(optionsArg.getText(sourceFile));
  }
  if (!ts.isObjectLiteralExpression(node)) return [];
  const preHandler = node.properties.find((prop) =>
    ts.isPropertyAssignment(prop) &&
    prop.name &&
    prop.name.getText(sourceFile) === 'preHandler'
  );
  if (!preHandler || !ts.isPropertyAssignment(preHandler)) return [];
  const value = preHandler.initializer;
  if (!ts.isArrayLiteralExpression(value)) return [shortExpr(value.getText(sourceFile))];
  return value.elements.map((element) => shortExpr(element.getText(sourceFile)));
}

function resolveBoundMethod(expr, sourceFile, includeDecl = false) {
  if (!ts.isCallExpression(expr)) return null;
  if (!ts.isPropertyAccessExpression(expr.expression)) return null;
  if (expr.expression.name.getText(sourceFile) !== 'bind') return null;
  const target = expr.expression.expression;
  if (!ts.isPropertyAccessExpression(target)) return null;
  const methodName = target.name.getText(sourceFile);
  const owner = target.expression.getText(sourceFile);
  const info = {
    type: 'bound-method',
    label: `${owner}.${methodName}.bind`,
    file: relFromRoot(sourceFile.fileName),
    line: lineOf(sourceFile, expr),
  };
  if (!includeDecl) return info;
  const decl = owner === 'controller'
    ? findDeclarationByName('ingestion', methodName, 'IngestionController')
    : null;
  return { ...info, decl };
}

function unwrapHandlerExpression(expr) {
  if (!ts.isCallExpression(expr)) return null;
  for (const arg of expr.arguments) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg) || ts.isIdentifier(arg)) {
      return arg;
    }
  }
  return null;
}

function getBodyNode(node) {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
    return node.body ?? null;
  }
  return null;
}

function isRouteOptionsArg(node) {
  return ts.isObjectLiteralExpression(node) || ts.isIdentifier(node);
}

function laneForFile(fileName) {
  const normalized = relFromRoot(fileName).toLowerCase();
  if (normalized.includes('repository')) return 'repository';
  if (normalized.includes('service') || normalized.includes('controller')) return 'service';
  return 'route';
}

function classifyCallLabel(text) {
  if (text.includes('.parse')) return `validate with ${text}`;
  if (text.startsWith('reply.')) return `reply via ${text}`;
  if (text.startsWith('service.') || text.startsWith('svc.') || text.includes('.service.')) return text;
  if (text.startsWith('controller.')) return text;
  if (text.includes('repo.')) return text;
  return text;
}

function shouldIgnoreCall(text) {
  return [
    'reply.send',
    'reply.code',
    'reply.status',
    'reply.header',
    'console.',
    'logger.',
    'fastify.',
    'Date.now',
    'Math.',
  ].some((prefix) => text.startsWith(prefix));
}

function compressNodes(nodes) {
  return uniqueBy(nodes, (node) => `${node.label}:${node.file}:${node.line}`).slice(0, 18);
}

function simpleNode(label, sourceFile, node) {
  return {
    label,
    file: sourceFile ? relFromRoot(sourceFile.fileName) : null,
    line: sourceFile && node ? lineOf(sourceFile, node) : null,
    children: [],
  };
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function literalText(node, sourceFile = undefined) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      out += `\${${span.expression.getText(sourceFile)}}${span.literal.text}`;
    }
    return out;
  }
  return null;
}

function walkDir(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else out.push(full);
  }
  return out;
}

function visit(node, cb, parentStack = []) {
  cb(node, parentStack);
  ts.forEachChild(node, (child) => visit(child, cb, [...parentStack, node]));
}

function joinPaths(prefix, route) {
  const left = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const right = route.startsWith('/') ? route : `/${route}`;
  return `${left}${right}`.replace(/\/+/g, '/');
}

function relFromRoot(file) {
  return normalizeRel(path.relative(ROOT, file));
}

function toAbs(relFile) {
  return normalizeAbs(path.join(ROOT, relFile));
}

function getSourceFile(file) {
  const abs = normalizeAbs(path.isAbsolute(file) ? file : path.join(ROOT, file));
  if (sourceFileMap.has(abs)) return sourceFileMap.get(abs);
  const targetRel = normalizeRel(path.relative(ROOT, abs)).toLowerCase();
  for (const [key, sourceFile] of sourceFileMap.entries()) {
    const rel = normalizeRel(path.relative(ROOT, key)).toLowerCase();
    if (rel === targetRel || rel.endsWith(targetRel)) return sourceFile;
  }
  return null;
}

function normalizeAbs(file) {
  return path.resolve(file).replace(/\\/g, '/');
}

function normalizeRel(file) {
  return file.replace(/\\/g, '/');
}

function shortExpr(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
