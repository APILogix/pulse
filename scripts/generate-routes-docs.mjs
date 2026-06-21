/**
 * Route Documentation Generator
 * 
 * Parses all route files from src/modules/* and generates docs/routes.html
 * with versioned route documentation and diff support.
 * 
 * Usage: node scripts/generate-routes-docs.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_PATH = path.join(ROOT_DIR, 'docs', 'routes.html');
const MODULES_DIR = path.join(ROOT_DIR, 'src', 'modules');

const MODULE_PREFIXES = {
  auth: '/auth',
  billing: '/billing',
  organization: '/organizations',
  projects: '/organizations/:orgId/projects',
  analytics: '/analytics',
  ingestion: '/ingestion',
  scim: '/scim/v2',
  webhooks: '/webhooks',
  alerting: '/alerting',
  ai: '/ai'
};

const AUTH_MIDDLEWARE_PATTERNS = [
  { pattern: /authenticate/, label: 'authenticate' },
  { pattern: /requireAdmin/, label: 'requireAdmin' },
  { pattern: /requireStepUp/, label: 'requireStepUp' },
  { pattern: /requireProjectMembership/, label: 'requireProjectMembership' },
  { pattern: /requireProjectMembershipFromBody/, label: 'requireProjectMembershipFromBody' },
  { pattern: /requireProjectMembershipFromQuery/, label: 'requireProjectMembershipFromQuery' },
  { pattern: /authenticateScim/, label: 'authenticateScim' }
];

function getAllRouteFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'shared' || entry.name === 'config' || entry.name === 'db' || entry.name === 'lib' || entry.name === 'workers' || entry.name === 'shared') {
        continue;
      }
      getAllRouteFiles(fullPath, files);
    } else if (entry.isFile() && (entry.name === 'routes.ts' || entry.name.endsWith('.routes.ts'))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function extractModuleName(filePath) {
  const relative = path.relative(MODULES_DIR, filePath);
  const parts = relative.split(path.sep);
  return parts[0];
}

function extractRoutes(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const moduleName = extractModuleName(filePath);
  const routes = [];
  
  const fastifyMethodPattern = /(?:fastify|server)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  let match;
  
  while ((match = fastifyMethodPattern.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    
    const lineStart = content.lastIndexOf('\n', match.index);
    const lineEnd = content.indexOf('\n', match.index);
    const lineContent = content.substring(lineStart, lineEnd);
    
    const authMatches = [];
    for (const { pattern, label } of AUTH_MIDDLEWARE_PATTERNS) {
      if (pattern.test(lineContent)) {
        authMatches.push(label);
      }
    }
    
    const rateLimitMatch = lineContent.match(/preHandler:\s*\[([^\]]+)\]/);
    let rateLimit = null;
    if (rateLimitMatch) {
      const rateLimitName = rateLimitMatch[1].split(',').map(s => s.trim()).find(s => s.includes('RateLimit') || s.includes('rateLimit'));
      if (rateLimitName) {
        rateLimit = rateLimitName.replace(/[^a-zA-Z]/g, '');
      }
    }
    
    let requiresAuth = authMatches.length > 0;
    let isAdminOnly = authMatches.includes('requireAdmin');
    let requiresStepUp = authMatches.includes('requireStepUp');
    
    routes.push({
      method,
      path: routePath,
      auth: authMatches.length > 0 ? authMatches : null,
      requiresAuth,
      isAdminOnly,
      requiresStepUp,
      rateLimit
    });
  }
  
  return { moduleName, routes };
}

function parseAllRoutes() {
  const routeFiles = getAllRouteFiles(MODULES_DIR);
  const moduleRoutes = {};
  
  for (const file of routeFiles) {
    const { moduleName, routes } = extractRoutes(file);
    if (!moduleRoutes[moduleName]) {
      moduleRoutes[moduleName] = {
        prefix: MODULE_PREFIXES[moduleName] || `/${moduleName}`,
        routes: []
      };
    }
    moduleRoutes[moduleName].routes.push(...routes);
  }
  
  return moduleRoutes;
}

function getExistingVersions() {
  if (!fs.existsSync(DOCS_PATH)) {
    return [];
  }
  
  const content = fs.readFileSync(DOCS_PATH, 'utf-8');
  const match = content.match(/const ROUTE_VERSIONS = (\[[\s\S]*?\]);/);
  
  if (match) {
    try {
      return eval(match[1]);
    } catch (e) {
      console.error('Failed to parse existing versions:', e.message);
    }
  }
  
  return [];
}

function detectChanges(oldRoutes, newRoutes) {
  const changes = {
    added: [],
    removed: [],
    modified: []
  };
  
  const oldRouteMap = new Map();
  for (const r of oldRoutes) {
    const key = `${r.method}:${r.path}`;
    oldRouteMap.set(key, r);
  }
  
  const newRouteMap = new Map();
  for (const r of newRoutes) {
    const key = `${r.method}:${r.path}`;
    newRouteMap.set(key, r);
  }
  
  for (const [key, route] of newRouteMap) {
    if (!oldRouteMap.has(key)) {
      changes.added.push(route);
    } else {
      const oldRoute = oldRouteMap.get(key);
      if (JSON.stringify(oldRoute.auth) !== JSON.stringify(route.auth) ||
          oldRoute.requiresAuth !== route.requiresAuth ||
          oldRoute.isAdminOnly !== route.isAdminOnly) {
        changes.modified.push({ before: oldRoute, after: route });
      }
    }
  }
  
  for (const [key, route] of oldRouteMap) {
    if (!newRouteMap.has(key)) {
      changes.removed.push(route);
    }
  }
  
  return changes;
}

function generateVersionId(existingVersions) {
  if (existingVersions.length === 0) return 'v1';
  const versions = existingVersions.map(v => {
    const match = v.id.match(/^v(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  });
  return `v${Math.max(...versions) + 1}`;
}

function generateChangelog(changes) {
  const parts = [];
  if (changes.added.length > 0) {
    parts.push(`Added ${changes.added.length} route(s): ${changes.added.map(r => `${r.method} ${r.path}`).join(', ')}`);
  }
  if (changes.removed.length > 0) {
    parts.push(`Removed ${changes.removed.length} route(s): ${changes.removed.map(r => `${r.method} ${r.path}`).join(', ')}`);
  }
  if (changes.modified.length > 0) {
    parts.push(`Modified ${changes.modified.length} route(s)`);
  }
  return parts.join(' | ') || 'No changes';
}

function generateRoutesHTML(routes) {
  const grouped = {};
  for (const route of routes) {
    const key = route.method;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(route);
  }
  
  let html = '';
  
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    if (!grouped[method]) continue;
    
    const methodClass = {
      GET: 'method-get',
      POST: 'method-post',
      PUT: 'method-put',
      PATCH: 'method-patch',
      DELETE: 'method-delete'
    }[method];
    
    for (const route of grouped[method]) {
      const authLabels = route.auth ? route.auth.map(a => `<span class="auth-tag">${a}</span>`).join('') : '';
      const rateLimitTag = route.rateLimit ? `<span class="rate-limit-tag">${route.rateLimit}</span>` : '';
      
      html += `        <tr class="route-row" data-method="${method}" data-path="${route.path}">
          <td><span class="method-badge ${methodClass}">${method}</span></td>
          <td class="route-path">${route.path}</td>
          <td>${authLabels || '<span class="no-auth">None</span>'}</td>
          <td>${rateLimitTag || '<span class="no-rate-limit">-</span>'}</td>
          <td>${route.isAdminOnly ? '<span class="admin-badge">Admin Only</span>' : '-'}</td>
        </tr>\n`;
    }
  }
  
  return html || '        <tr><td colspan="5" class="no-routes">No routes found</td></tr>';
}

function generateModuleSection(moduleName, moduleData) {
  const routeCount = moduleData.routes.length;
  const routeListHTML = generateRoutesHTML(moduleData.routes);
  
  return `    <div class="module-content" id="module-${moduleName}" style="display: none;">
      <div class="module-header">
        <h2>${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)} Module</h2>
        <div class="module-info">
          <span class="prefix">Prefix: <code>${moduleData.prefix}</code></span>
          <span class="route-count">${routeCount} routes</span>
        </div>
      </div>
      <div class="table-container">
        <table class="routes-table">
          <thead>
            <tr>
              <th class="sortable" data-sort="method">Method</th>
              <th class="sortable" data-sort="path">Path</th>
              <th>Auth</th>
              <th>Rate Limit</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
${routeListHTML}          </tbody>
        </table>
      </div>
    </div>`;
}

function generateHTML(newVersion, allVersions) {
  const versionData = JSON.stringify(allVersions, null, 4);
  
  const modulesHTML = Object.entries({
    auth: newVersion.modules.auth || { prefix: '/auth', routes: [] },
    billing: newVersion.modules.billing || { prefix: '/billing', routes: [] },
    organization: newVersion.modules.organization || { prefix: '/organizations', routes: [] },
    projects: newVersion.modules.projects || { prefix: '/organizations/:orgId/projects', routes: [] },
    analytics: newVersion.modules.analytics || { prefix: '/analytics', routes: [] },
    ingestion: newVersion.modules.ingestion || { prefix: '/ingestion', routes: [] },
    scim: newVersion.modules.scim || { prefix: '/scim/v2', routes: [] },
    webhooks: newVersion.modules.webhooks || { prefix: '/webhooks', routes: [] }
  }).map(([name, data]) => generateModuleSection(name, data)).join('\n');
  
  const versionOptions = allVersions.map(v => 
    `        <option value="${v.id}">${v.id} - ${new Date(v.generatedAt).toLocaleDateString()}</option>`
  ).join('\n');
  
  const diffVersionOptions = allVersions.slice().reverse().map(v => 
    `          <option value="${v.id}">${v.id}</option>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Route Documentation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f7fa;
      color: #333;
      line-height: 1.6;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2rem;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    
    .header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .header .meta { opacity: 0.9; font-size: 0.9rem; }
    
    .controls {
      background: white;
      padding: 1rem 2rem;
      border-bottom: 1px solid #e1e5eb;
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      align-items: center;
    }
    
    .control-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .control-group label { font-weight: 500; }
    
    select, button {
      padding: 0.5rem 1rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.9rem;
      background: white;
      cursor: pointer;
    }
    
    button {
      background: #667eea;
      color: white;
      border: none;
      font-weight: 500;
      transition: background 0.2s;
    }
    
    button:hover { background: #5a6fd6; }
    button.diff-btn { background: #28a745; }
    button.diff-btn:hover { background: #218838; }
    
    .module-tabs {
      background: white;
      padding: 0 2rem;
      display: flex;
      gap: 0;
      border-bottom: 1px solid #e1e5eb;
      overflow-x: auto;
    }
    
    .module-tab {
      padding: 1rem 1.5rem;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 0.95rem;
      color: #666;
      border-bottom: 3px solid transparent;
      white-space: nowrap;
    }
    
    .module-tab:hover { color: #667eea; }
    .module-tab.active {
      color: #667eea;
      border-bottom-color: #667eea;
      font-weight: 500;
    }
    
    .module-content {
      padding: 2rem;
    }
    
    .module-header {
      margin-bottom: 1.5rem;
    }
    
    .module-header h2 {
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    
    .module-info {
      display: flex;
      gap: 2rem;
      font-size: 0.9rem;
      color: #666;
    }
    
    .module-info code {
      background: #e9ecef;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.85rem;
    }
    
    .table-container {
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    
    .routes-table {
      width: 100%;
      border-collapse: collapse;
    }
    
    .routes-table th {
      background: #f8f9fa;
      padding: 1rem;
      text-align: left;
      font-weight: 600;
      font-size: 0.85rem;
      text-transform: uppercase;
      color: #666;
      border-bottom: 2px solid #e9ecef;
    }
    
    .routes-table td {
      padding: 0.875rem 1rem;
      border-bottom: 1px solid #f0f0f0;
      vertical-align: middle;
    }
    
    .routes-table tr:hover { background: #f8f9fa; }
    
    .method-badge {
      display: inline-block;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .method-get { background: #d1ecf1; color: #0c5460; }
    .method-post { background: #d4edda; color: #155724; }
    .method-put { background: #fff3cd; color: #856404; }
    .method-patch { background: #e2e3e5; color: #383d41; }
    .method-delete { background: #f8d7da; color: #721c24; }
    
    .route-path {
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.9rem;
      color: #333;
    }
    
    .auth-tag, .rate-limit-tag, .admin-badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
      margin-right: 0.25rem;
      margin-bottom: 0.25rem;
    }
    
    .auth-tag { background: #e7e3ff; color: #5a30b5; }
    .rate-limit-tag { background: #fff3cd; color: #856404; }
    .admin-badge { background: #f8d7da; color: #721c24; }
    
    .no-auth, .no-rate-limit { color: #999; font-size: 0.85rem; }
    .no-routes { text-align: center; color: #666; padding: 2rem; }
    
    .modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    
    .modal.active { display: flex; }
    
    .modal-content {
      background: white;
      border-radius: 12px;
      width: 95%;
      max-width: 1200px;
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    
    .modal-header {
      padding: 1.5rem;
      border-bottom: 1px solid #e1e5eb;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .modal-header h2 { font-size: 1.25rem; }
    
    .modal-close {
      background: none;
      border: none;
      font-size: 1.5rem;
      cursor: pointer;
      color: #666;
    }
    
    .modal-body {
      padding: 1.5rem;
      overflow-y: auto;
      flex: 1;
    }
    
    .diff-controls {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
      align-items: center;
    }
    
    .diff-legend {
      display: flex;
      gap: 1rem;
      font-size: 0.85rem;
    }
    
    .diff-legend span { display: flex; align-items: center; gap: 0.3rem; }
    .diff-legend .added { color: #28a745; }
    .diff-legend .removed { color: #dc3545; }
    .diff-legend .modified { color: #ffc107; }
    
    .diff-table {
      width: 100%;
      border-collapse: collapse;
    }
    
    .diff-table th {
      background: #f8f9fa;
      padding: 0.75rem;
      text-align: left;
      font-weight: 600;
      font-size: 0.8rem;
      text-transform: uppercase;
      color: #666;
      border-bottom: 2px solid #e9ecef;
      position: sticky;
      top: 0;
    }
    
    .diff-table td {
      padding: 0.75rem;
      border-bottom: 1px solid #f0f0f0;
      font-size: 0.9rem;
      vertical-align: top;
    }
    
    .diff-added { background: #d4edda !important; }
    .diff-removed { background: #f8d7da !important; }
    .diff-modified { background: #fff3cd !important; }
    
    .version-history {
      background: white;
      border-radius: 8px;
      margin: 2rem;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    
    .version-history h3 {
      margin-bottom: 1rem;
      font-size: 1.1rem;
    }
    
    .version-list {
      list-style: none;
    }
    
    .version-item {
      padding: 0.75rem;
      border-radius: 6px;
      margin-bottom: 0.5rem;
      background: #f8f9fa;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .version-item.current {
      background: #e7e3ff;
      border: 1px solid #667eea;
    }
    
    .version-id { font-weight: 600; }
    .version-date { color: #666; font-size: 0.85rem; }
    .version-changes { font-size: 0.85rem; color: #555; margin-top: 0.25rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>API Route Documentation</h1>
    <div class="meta">
      <span id="generated-at">Generated: ${new Date().toISOString()}</span>
      <span style="margin-left: 1rem;">|</span>
      <span style="margin-left: 1rem;"><span id="total-routes">0</span> total routes</span>
    </div>
  </div>
  
  <div class="controls">
    <div class="control-group">
      <label>View Version:</label>
      <select id="version-select">${versionOptions}
      </select>
    </div>
    <div class="control-group">
      <button id="refresh-btn" onclick="location.reload()">Refresh</button>
    </div>
    <div class="control-group">
      <button class="diff-btn" id="diff-btn">Compare Versions</button>
    </div>
    <div class="diff-legend" style="margin-left: auto;">
      <span class="added">■ Added</span>
      <span class="removed">■ Removed</span>
      <span class="modified">■ Modified</span>
    </div>
  </div>
  
  <div class="module-tabs" id="module-tabs">
    <button class="module-tab active" data-module="auth">Auth</button>
    <button class="module-tab" data-module="billing">Billing</button>
    <button class="module-tab" data-module="organization">Organizations</button>
    <button class="module-tab" data-module="projects">Projects</button>
    <button class="module-tab" data-module="analytics">Analytics</button>
    <button class="module-tab" data-module="ingestion">Ingestion</button>
    <button class="module-tab" data-module="scim">SCIM</button>
    <button class="module-tab" data-module="webhooks">Webhooks</button>
  </div>
  
${modulesHTML}
  
  <div class="version-history">
    <h3>Version History</h3>
    <ul class="version-list" id="version-list"></ul>
  </div>
  
  <div class="modal" id="diff-modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Version Comparison</h2>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="diff-controls">
          <div class="control-group">
            <label>From:</label>
            <select id="diff-from">${diffVersionOptions}
            </select>
          </div>
          <div class="control-group">
            <label>To:</label>
            <select id="diff-to">${diffVersionOptions}
            </select>
          </div>
          <button id="run-diff">Show Diff</button>
        </div>
        <div id="diff-output"></div>
      </div>
    </div>
  </div>

  <script>
    const ROUTE_VERSIONS = ${versionData};
    
    let currentVersion = null;
    let routeData = {};
    
    function init() {
      const select = document.getElementById('version-select');
      currentVersion = select.value;
      loadVersion(currentVersion);
      renderVersionHistory();
      updateTotalRoutes();
      
      select.addEventListener('change', (e) => {
        currentVersion = e.target.value;
        loadVersion(currentVersion);
      });
      
      document.querySelectorAll('.module-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.module-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          showModule(tab.dataset.module);
        });
      });
      
      document.getElementById('diff-btn').addEventListener('click', openDiffModal);
      document.getElementById('modal-close').addEventListener('click', closeDiffModal);
      document.getElementById('run-diff').addEventListener('click', computeDiff);
      
      document.getElementById('diff-to').value = currentVersion;
      if (document.getElementById('diff-from').options.length > 1) {
        document.getElementById('diff-from').selectedIndex = document.getElementById('diff-from').options.length - 2;
      }
    }
    
    function loadVersion(versionId) {
      const version = ROUTE_VERSIONS.find(v => v.id === versionId);
      if (!version) return;
      
      routeData = version.modules;
      updateTotalRoutes();
    }
    
    function updateTotalRoutes() {
      let total = 0;
      for (const mod of Object.values(routeData)) {
        if (mod && mod.routes) total += mod.routes.length;
      }
      document.getElementById('total-routes').textContent = total;
    }
    
    function showModule(name) {
      document.querySelectorAll('.module-content').forEach(el => el.style.display = 'none');
      const modEl = document.getElementById('module-' + name);
      if (modEl) modEl.style.display = 'block';
    }
    
    function renderVersionHistory() {
      const list = document.getElementById('version-list');
      list.innerHTML = ROUTE_VERSIONS.slice().reverse().map(v => {
        const isCurrent = v.id === currentVersion;
        return '<li class="version-item' + (isCurrent ? ' current' : '') + '">' +
          '<div>' +
            '<span class="version-id">' + v.id + '</span>' +
            '<span class="version-date"> - ' + new Date(v.generatedAt).toLocaleString() + '</span>' +
            (v.changelog ? '<div class="version-changes">' + v.changelog + '</div>' : '') +
          '</div>' +
          (isCurrent ? '<span style="color:#667eea;font-size:0.8rem;">Current</span>' : '') +
        '</li>';
      }).join('');
    }
    
    function openDiffModal() {
      document.getElementById('diff-modal').classList.add('active');
    }
    
    function closeDiffModal() {
      document.getElementById('diff-modal').classList.remove('active');
    }
    
    function computeDiff() {
      const fromId = document.getElementById('diff-from').value;
      const toId = document.getElementById('diff-to').value;
      
      const fromVer = ROUTE_VERSIONS.find(v => v.id === fromId);
      const toVer = ROUTE_VERSIONS.find(v => v.id === toId);
      
      if (!fromVer || !toVer) return;
      
      const allModules = [...new Set([...Object.keys(fromVer.modules), ...Object.keys(toVer.modules)])];
      let html = '<table class="diff-table"><thead><tr><th>Module</th><th>Change</th><th>Method</th><th>Path</th><th>Details</th></tr></thead><tbody>';
      
      for (const modName of allModules.sort()) {
        const fromMod = fromVer.modules[modName] || { routes: [] };
        const toMod = toVer.modules[modName] || { routes: [] };
        
        const fromRoutes = new Map(fromMod.routes.map(r => [r.method + ':' + r.path, r]));
        const toRoutes = new Map(toMod.routes.map(r => [r.method + ':' + r.path, r]));
        
        for (const [key, route] of toRoutes) {
          if (!fromRoutes.has(key)) {
            html += '<tr class="diff-added"><td>' + modName + '</td><td>Added</td><td>' + route.method + '</td><td>' + route.path + '</td><td>-</td></tr>';
          } else {
            const fromRoute = fromRoutes.get(key);
            if (JSON.stringify(fromRoute.auth) !== JSON.stringify(route.auth)) {
              html += '<tr class="diff-modified"><td>' + modName + '</td><td>Modified</td><td>' + route.method + '</td><td>' + route.path + '</td><td>Auth changed</td></tr>';
            }
          }
        }
        
        for (const [key, route] of fromRoutes) {
          if (!toRoutes.has(key)) {
            html += '<tr class="diff-removed"><td>' + modName + '</td><td>Removed</td><td>' + route.method + '</td><td>' + route.path + '</td><td>-</td></tr>';
          }
        }
      }
      
      html += '</tbody></table>';
      
      if (html.includes('diff-added') || html.includes('diff-removed') || html.includes('diff-modified')) {
        document.getElementById('diff-output').innerHTML = html;
      } else {
        document.getElementById('diff-output').innerHTML = '<p style="text-align:center;color:#666;padding:2rem;">No differences found between selected versions.</p>';
      }
    }
    
    init();
  </script>
</body>
</html>`;
}

async function main() {
  console.log('🔍 Analyzing route files...');
  
  const moduleRoutes = parseAllRoutes();
  
  const existingVersions = getExistingVersions();
  const newVersionId = generateVersionId(existingVersions);
  
  let changes = { added: [], removed: [], modified: [] };
  
  if (existingVersions.length > 0) {
    const latestVersion = existingVersions[existingVersions.length - 1];
    
    for (const [modName, modData] of Object.entries(moduleRoutes)) {
      const oldModData = latestVersion.modules[modName] || { routes: [] };
      const modChanges = detectChanges(oldModData.routes, modData.routes);
      
      if (modChanges.added.length > 0) {
        changes.added.push(...modChanges.added.map(r => ({ ...r, module: modName })));
      }
      if (modChanges.removed.length > 0) {
        changes.removed.push(...modChanges.removed.map(r => ({ ...r, module: modName })));
      }
      if (modChanges.modified.length > 0) {
        changes.modified.push(...modChanges.modified.map(m => ({ ...m, module: modName })));
      }
    }
  }
  
  const hasChanges = changes.added.length > 0 || changes.removed.length > 0 || changes.modified.length > 0;
  
  let allVersions;
  let newVersion;
  
  if (hasChanges || existingVersions.length === 0) {
    newVersion = {
      id: newVersionId,
      generatedAt: new Date().toISOString(),
      modules: moduleRoutes,
      changelog: generateChangelog(changes)
    };
    allVersions = [...existingVersions, newVersion];
  } else {
    allVersions = existingVersions;
    newVersion = existingVersions[existingVersions.length - 1];
  }
  
  const html = generateHTML(newVersion, allVersions);
  
  fs.writeFileSync(DOCS_PATH, html, 'utf-8');
  
  if (hasChanges || existingVersions.length === 0) {
    console.log('✅ Documentation generated successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log('   Version:', newVersionId);
    console.log('   Modules:', Object.keys(moduleRoutes).length);
    
    let totalRoutes = 0;
    for (const mod of Object.values(moduleRoutes)) {
      totalRoutes += mod.routes.length;
    }
    console.log('   Total Routes:', totalRoutes);
    
    if (hasChanges) {
      console.log('');
      console.log('📝 Changes detected:');
      if (changes.added.length > 0) {
        console.log('   + Added:', changes.added.length, 'routes');
      }
      if (changes.removed.length > 0) {
        console.log('   - Removed:', changes.removed.length, 'routes');
      }
      if (changes.modified.length > 0) {
        console.log('   ~ Modified:', changes.modified.length, 'routes');
      }
    }
  } else {
    console.log('ℹ️  No changes detected. Documentation is up to date.');
    console.log('   Current version:', newVersion.id);
    let totalRoutes = 0;
    for (const mod of Object.values(newVersion.modules)) {
      totalRoutes += mod.routes.length;
    }
    console.log('   Total routes:', totalRoutes);
  }
  
  console.log('');
  console.log('📄 Output:', DOCS_PATH);
}

main().catch(console.error);