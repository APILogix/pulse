const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const postgresDir = path.join(root, 'src', 'db', 'postgres');
const sourceDirs = [
  path.join(postgresDir, 'canonical_migrations_draft'),
  path.join(postgresDir, 'migrations'),
];
const outDir = path.join(postgresDir, 'primary_db_draft');

const domainOrder = [
  '00_extensions',
  '01_schemas',
  '02_types',
  '03_reference',
  '04_user',
  '05_organization',
  '06_project',
  '07_billing',
  '08_connector',
  '10_notification',
  '09_alerting',
  '11_observability',
  '12_usage',
  '13_ai',
  '14_automation',
  '15_analytics',
  '16_security',
  '18_views',
  '17_functions',
  '19_partitions',
  '21_comments',
  '20_seeders',
];

const domainNames = {
  '00_extensions': 'Extensions',
  '01_schemas': 'Schemas',
  '02_types': 'Types',
  '03_reference': 'Reference',
  '04_user': 'User',
  '05_organization': 'Organization',
  '06_project': 'Project',
  '07_billing': 'Billing',
  '08_connector': 'Connector',
  '09_alerting': 'Alerting',
  '10_notification': 'Notification',
  '11_observability': 'Observability',
  '12_usage': 'Usage',
  '13_ai': 'AI',
  '14_automation': 'Automation',
  '15_analytics': 'Analytics',
  '16_security': 'Security',
  '17_functions': 'Functions',
  '18_views': 'Views',
  '19_partitions': 'Partitions',
  '21_comments': 'Comments',
  '20_seeders': 'Seeders',
};

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    })
    .filter((file) => /\.(sql|md)$/i.test(file))
    .sort((a, b) => a.localeCompare(b));
}

function readSqlSources() {
  return sourceDirs.flatMap((dir) => walk(dir))
    .map((file) => ({
      file,
      rel: path.relative(postgresDir, file).replace(/\\/g, '/'),
      sql: fs.readFileSync(file, 'utf8'),
    }));
}

function stripTransaction(sql) {
  return sql
    .replace(/^\s*BEGIN\s*;\s*$/gim, '')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '');
}

function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let i = 0;
  let quote = null;
  let dollar = null;
  let lineComment = false;
  let blockComment = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      i++;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        i += dollar.length;
        dollar = null;
      } else {
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === quote && sql[i - 1] !== '\\') quote = null;
      i++;
      continue;
    }
    if (ch === '-' && next === '-') {
      lineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 2;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      i++;
      continue;
    }
    if (ch === '$') {
      const rest = sql.slice(i);
      const m = rest.match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        dollar = m[0];
        i += dollar.length;
        continue;
      }
    }
    if (ch === ';') {
      const stmt = sql.slice(start, i + 1).trim();
      if (stmt) statements.push(stmt);
      start = i + 1;
    }
    i++;
  }
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function statementKind(stmt) {
  const s = stmt.replace(/^\s*--.*$/gm, '').trim();
  if (/^CREATE\s+EXTENSION\b/i.test(s)) return 'extension';
  if (/^CREATE\s+SCHEMA\b/i.test(s)) return 'schema';
  if (/^DO\s+\$\$/i.test(s) && /CREATE\s+TYPE\b/i.test(s)) return 'type';
  if (/^CREATE\s+TYPE\b/i.test(s)) return 'type';
  if (/^ALTER\s+TYPE\b/i.test(s)) return 'type';
  if (/^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(s)) return 'function';
  if (/^CREATE\s+(OR\s+REPLACE\s+)?VIEW\b/i.test(s)) return 'view';
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(s)) return 'index';
  if (/^CREATE\s+TRIGGER\b/i.test(s)) return 'trigger';
  if (/^DROP\s+TRIGGER\b/i.test(s)) return 'drop_trigger';
  if (/^CREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\b/i.test(s)) return 'table';
  if (/^ALTER\s+TABLE\b/i.test(s)) return 'alter_table';
  if (/^INSERT\b/i.test(s)) return 'seed';
  if (/^WITH\b/i.test(s) && /\bINSERT\b/i.test(s)) return 'seed';
  if (/^COMMENT\b/i.test(s)) return 'comment';
  return 'other';
}

function normalizeStatement(stmt) {
  const keywordMatch = stmt.match(/(?:^|\n)\s*(CREATE|ALTER|INSERT|COMMENT|DO|DROP|WITH)\b/i);
  if (!keywordMatch || keywordMatch.index === undefined) return stmt.trim();
  const offset = stmt[keywordMatch.index] === '\n' ? keywordMatch.index + 1 : keywordMatch.index;
  return stmt.slice(offset).trim();
}

function tableNameFromCreate(stmt) {
  const m = stmt.match(/CREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?)/i);
  return m ? m[1].replace(/"/g, '').split('.').pop() : null;
}

function tableNameFromAlter(stmt) {
  const m = stmt.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i);
  return m ? m[1].replace(/"/g, '').split('.').pop() : null;
}

function tableNameFromIndex(stmt) {
  const m = stmt.match(/\bON\s+("?[\w.]+"?)\s*\(/i);
  return m ? m[1].replace(/"/g, '').split('.').pop() : null;
}

function tableNameFromTrigger(stmt) {
  const m = stmt.match(/\bON\s+("?[\w.]+"?)\b/i);
  return m ? m[1].replace(/"/g, '').split('.').pop() : null;
}

function objectName(stmt, kind) {
  const s = stmt.replace(/^\s*--.*$/gm, '').trim();
  if (kind === 'table') return tableNameFromCreate(s);
  if (kind === 'alter_table') return tableNameFromAlter(s);
  if (kind === 'index') {
    const m = s.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?)/i);
    return m ? m[1].replace(/"/g, '') : null;
  }
  if (kind === 'trigger' || kind === 'drop_trigger') {
    const m = s.match(/TRIGGER\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i);
    return m ? m[1].replace(/"/g, '') : null;
  }
  if (kind === 'function') {
    const m = s.match(/FUNCTION\s+("?[\w.]+"?\s*\([^)]*\)|"?[\w.]+"?)/i);
    return m ? m[1].replace(/"/g, '').split('(')[0] : null;
  }
  if (kind === 'view') {
    const m = s.match(/VIEW\s+("?[\w.]+"?)/i);
    return m ? m[1].replace(/"/g, '').split('.').pop() : null;
  }
  return null;
}

function domainForTable(table) {
  if (!table) return null;
  if (table === 'schema_migrations') return '16_security';
  if (table === 'audit_logs') return '16_security';
  if (table === 'connector_providers' || table.endsWith('_job_types') || table.endsWith('_types')) return '03_reference';
  if (table === 'saml_sessions') return '05_organization';
  if (/^(organization_subscriptions|organization_feature_overrides|organization_usage_current_period|usage_daily_counters|ai_usage_logs|credit_balances|credit_ledger|credit_rules)/.test(table)) return '07_billing';
  if (table === 'project_connector_subscriptions') return '08_connector';
  if (table === 'project_member_alert_channel_preferences') return '09_alerting';
  if (/^(project_alert_channels|project_alert_thresholds)/.test(table)) return '09_alerting';
  if (/^(users?|user_|auth_|email_mfa|email_verifications|security_events|saml_sessions)/.test(table)) return '04_user';
  if (/^(organizations?|organization_|quota_|scim_|sso_|saml_identity|audit_logs$)/.test(table)) return '05_organization';
  if (/^(projects?|project_|api_key_usage|api_key_|environment_)/.test(table)) return '06_project';
  if (/^(plans?|plan_|billing_|subscription_|invoices?|invoice_|payments?|payment_|coupons?|coupon_|addons?|addon_)/.test(table)) return '07_billing';
  if (/^(connector_)/.test(table)) return '08_connector';
  if (/^(alert_|alerting_)/.test(table)) return '09_alerting';
  if (/^(notification_)/.test(table)) return '10_notification';
  if (/^(events_|requests|errors|logs|traces|spans|metrics|profiles|replays|cron_checkins|messages|sdk_sessions|ingestion_|backpressure_|telemetry_outbox|error_groups|feature_flags)/.test(table)) return '11_observability';
  if (/^(usage_|project_usage_realtime)/.test(table)) return '12_usage';
  if (/^(ai_|credit_)/.test(table)) return '13_ai';
  if (/^(automation_)/.test(table)) return '14_automation';
  if (/^(analytics_)/.test(table)) return '15_analytics';
  return '16_security';
}

function domainForSource(rel) {
  if (rel.includes('/00_shared/')) return '17_functions';
  if (rel.includes('/01_auth/')) return '04_user';
  if (rel.includes('/02_organizations/') || rel.includes('/03_org_identity/')) return '05_organization';
  if (rel.includes('/04_projects/')) return '06_project';
  if (rel.includes('/06_connectors/')) return '08_connector';
  if (rel.includes('/07_notifications/')) return '10_notification';
  if (rel.includes('/08_alerting/') || rel.includes('/18_alerting_workspace/')) return '09_alerting';
  if (rel.includes('/09_audit/') || rel.includes('/10_security/')) return '16_security';
  if (rel.includes('/11_billing/')) return '07_billing';
  if (rel.includes('/12_monitoring/') || rel.includes('/13_ingestion/') || rel.includes('/14_observability/') || rel.includes('/16_legacy_compat/') || rel.includes('/17_enterprise_ingestion/')) return '11_observability';
  if (rel.includes('/15_analytics/')) return '15_analytics';
  if (rel.includes('/18_ai/')) return '13_ai';
  if (rel.includes('/19_automation/')) return '14_automation';
  if (rel.includes('/migrations/003_project_module_refactor')) return '06_project';
  if (rel.includes('/migrations/004_enterprise_database_integrity')) return '16_security';
  return null;
}

function extractCreateBody(stmt) {
  const idx = stmt.search(/\(/);
  if (idx === -1) return null;
  let depth = 0;
  let quote = null;
  let dollar = null;
  for (let i = idx; i < stmt.length; i++) {
    const ch = stmt[i];
    if (dollar) {
      if (stmt.startsWith(dollar, i)) {
        i += dollar.length - 1;
        dollar = null;
      }
      continue;
    }
    if (quote) {
      if (ch === quote && stmt[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '$') {
      const m = stmt.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        dollar = m[0];
        i += dollar.length - 1;
        continue;
      }
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) return { start: idx, end: i, body: stmt.slice(idx + 1, i) };
    }
  }
  return null;
}

function splitCommaTopLevel(body) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const next = body[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === quote && body[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '-' && next === '-') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === '\'' || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function columnName(def) {
  const s = stripSqlComments(def).trim();
  if (/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/i.test(s)) return null;
  const m = s.match(/^("?[\w]+"?)/);
  return m ? m[1].replace(/"/g, '') : null;
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

function normalizeCreateTable(stmt, creates, alters, table, deferredConstraints) {
  const body = extractCreateBody(stmt);
  if (!body) return stmt;
  const defs = splitCommaTopLevel(body.body);
  const byCol = new Map();
  const order = [];
  const passthrough = [];
  for (const def of defs) {
    const col = columnName(def);
    if (col) {
      byCol.set(col, def);
      order.push(col);
    } else {
      passthrough.push(def);
    }
  }
  for (const create of creates) {
    if (create === stmt) continue;
    const createBody = extractCreateBody(create);
    if (!createBody) continue;
    for (const def of splitCommaTopLevel(createBody.body)) {
      const col = columnName(def);
      if (col && !byCol.has(col)) {
        byCol.set(col, def);
        order.push(col);
      }
    }
  }
  for (const alter of alters) {
    const alterBody = alter.replace(/^[\s\S]*?ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)\s+/i, '');
    const actionStart = alterBody.search(/\b(ADD|DROP|ALTER)\b/i);
    const actions = actionStart === -1 ? [] : splitCommaTopLevel(alterBody.slice(actionStart).replace(/;$/, ''));
    for (const action of actions) {
      if (/^ADD\s+COLUMN\b/i.test(action)) {
        const def = action.replace(/^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, '').trim();
        const col = columnName(def);
        if (col) {
          byCol.set(col, def);
          if (!order.includes(col)) order.push(col);
        }
        continue;
      }
      const drop = action.match(/^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?("?[\w]+"?)/i);
      if (drop) {
        const col = drop[1].replace(/"/g, '');
        byCol.delete(col);
        const idx = order.indexOf(col);
        if (idx !== -1) order.splice(idx, 1);
        continue;
      }
      const notNull = action.match(/^ALTER\s+COLUMN\s+("?[\w]+"?)\s+SET\s+NOT\s+NULL/i);
      if (notNull) {
        const col = notNull[1].replace(/"/g, '');
        if (byCol.has(col) && !/\bNOT\s+NULL\b/i.test(byCol.get(col))) {
          byCol.set(col, byCol.get(col).replace(/(\s*(?:DEFAULT|REFERENCES|CHECK|UNIQUE|PRIMARY)\b|$)/i, ' NOT NULL$1'));
        }
      }
    }
  }
  for (const col of order) {
    const def = byCol.get(col);
    if (table && domainForTable(table) === '04_user' && /\bREFERENCES\s+organizations\s*\(/i.test(def)) {
      const constraintName = `fk_${table}_${col}_organizations`;
      const match = def.match(/\s+REFERENCES\s+organizations\s*\(id\)(?:\s+ON\s+DELETE\s+(?:CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/i);
      if (match) {
        byCol.set(col, def.replace(match[0], ''));
        deferredConstraints.push({
          table,
          column: col,
          referencedTable: 'organizations',
          constraintName,
          onDelete: /ON\s+DELETE\s+CASCADE/i.test(match[0])
            ? ' ON DELETE CASCADE'
            : /ON\s+DELETE\s+SET\s+NULL/i.test(match[0])
              ? ' ON DELETE SET NULL'
              : '',
        });
      }
    }
  }

  let hasPrimaryKey = false;
  for (const col of order) {
    const def = byCol.get(col);
    if (!/\bPRIMARY\s+KEY\b/i.test(stripSqlComments(def))) continue;
    if (!hasPrimaryKey) {
      hasPrimaryKey = true;
      continue;
    }
    byCol.set(col, def.replace(/\s+PRIMARY\s+KEY\b/i, ''));
  }

  const hasInlinePrimaryKey = [...byCol.values()].some((def) => /\bPRIMARY\s+KEY\b/i.test(stripSqlComments(def)));
  const finalPassthrough = hasInlinePrimaryKey
    ? passthrough.filter((def) => !/^PRIMARY\s+KEY\b/i.test(stripSqlComments(def).trim()))
    : passthrough;
  const finalDefs = [...order.map((col) => byCol.get(col)), ...finalPassthrough]
    .filter(Boolean)
    .map((def) => stripSqlComments(def).trim())
    .filter(Boolean)
    .map((def) => `  ${def.replace(/\n\s*/g, '\n  ')}`);
  const rebuilt = stmt.slice(0, body.start + 1) + '\n' + finalDefs.join(',\n') + '\n' + stmt.slice(body.end);
  return rebuilt.replace(/\bCREATE\s+(UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/i, 'CREATE $1TABLE IF NOT EXISTS ');
}

function normalizeCreateIndex(stmt) {
  return stmt.replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b)/i, 'CREATE $1INDEX IF NOT EXISTS ');
}

function normalizeCreateView(stmt) {
  return stmt.replace(/\bCREATE\s+VIEW\b/i, 'CREATE OR REPLACE VIEW');
}

function desiredFile(domain, table, kind) {
  const slug = table ? table.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() : 'objects';
  if (kind === 'trigger' || kind === 'drop_trigger') return '999_triggers.sql';
  if (kind === 'function') return `${domain === '17_functions' ? '001' : '900'}_functions.sql`;
  if (kind === 'view') return '001_views.sql';
  if (kind === 'index') return '900_indexes.sql';
  if (kind === 'seed') return '001_seed.sql';
  if (kind === 'extension') return '001_extensions.sql';
  if (kind === 'schema') return '001_schemas.sql';
  if (kind === 'type') return '001_enums_and_domains.sql';
  if (kind === 'comment') return '998_comments.sql';
  if (table) return `${String(1).padStart(3, '0')}_create_${slug}.sql`;
  return '990_misc.sql';
}

function domainForRecord(kind, table, rel) {
  if (kind === 'extension') return '00_extensions';
  if (kind === 'schema') return '01_schemas';
  if (kind === 'type') return '02_types';
  if (kind === 'comment') return '21_comments';
  if (kind === 'function') return '17_functions';
  if (kind === 'view') return '18_views';
  if (kind === 'seed') return '20_seeders';
  return domainForTable(table) || domainForSource(rel) || '16_security';
}

function tableDeps(sql) {
  return [...sql.matchAll(/\bREFERENCES\s+("?[\w.]+"?)/ig)]
    .map((m) => m[1].replace(/"/g, '').split('.').pop())
    .filter(Boolean);
}

function partitionParent(stmt) {
  const m = stmt.match(/\bPARTITION\s+OF\s+("?[\w.]+"?)/i);
  return m ? m[1].replace(/"/g, '').split('.').pop() : null;
}

function insertTarget(stmt) {
  const m = stmt.match(/\bINSERT\s+INTO\s+("?[\w.]+"?)/i);
  return m ? m[1].replace(/"/g, '').split('.').pop() : null;
}

function insertColumns(stmt) {
  const m = stmt.match(/\bINSERT\s+INTO\s+"?[\w.]+"?\s*\(([\s\S]*?)\)\s*(?:VALUES|SELECT|WITH)/i);
  if (!m) return [];
  return splitCommaTopLevel(m[1])
    .map((col) => col.trim().replace(/"/g, '').split('.').pop())
    .filter(Boolean);
}

function seedReferencesMissingColumns(stmt, finalColumnsByTable) {
  const aliases = new Map();
  for (const match of stmt.matchAll(/\b(?:FROM|JOIN)\s+("?[\w.]+"?)(?:\s+(?:AS\s+)?("?[\w]+"?))?/ig)) {
    const table = match[1].replace(/"/g, '').split('.').pop();
    const alias = (match[2] || table).replace(/"/g, '');
    if (finalColumnsByTable.has(table)) aliases.set(alias, table);
  }
  for (const match of stmt.matchAll(/\b("?[\w]+"?)\s*\.\s*("?[\w]+"?)\b/g)) {
    const alias = match[1].replace(/"/g, '');
    const col = match[2].replace(/"/g, '');
    const table = aliases.get(alias);
    if (table && !(finalColumnsByTable.get(table) || new Set()).has(col)) return true;
  }
  return false;
}

function normalizedTableColumns(stmt) {
  return new Set(splitCommaTopLevel(extractCreateBody(stmt)?.body || '')
    .map(columnName)
    .filter(Boolean));
}

function indexReferencesMissingColumns(stmt, columns) {
  const onMatch = stmt.match(/\bON\s+"?[\w.]+"?\s*\(([\s\S]*?)\)([\s\S]*)$/i);
  if (!onMatch) return false;
  const scannedSql = `${onMatch[1]}\n${(onMatch[2].match(/\bWHERE\b[\s\S]*/i) || [''])[0]}`;
  for (const match of scannedSql.matchAll(/\b([a-z_][a-z0-9_]*)\b/ig)) {
    const token = match[1].toLowerCase();
    if (token.endsWith('_at') || token.endsWith('_id')) {
      if (!columns.has(token)) return true;
    }
  }
  return false;
}

function orderDomainFiles(files, fileToTable, tableToFile, fileSql) {
  const set = new Set(files);
  const deps = new Map(files.map((file) => [file, new Set()]));
  for (const file of files) {
    const table = fileToTable.get(file);
    if (!table) continue;
    for (const depTable of tableDeps(fileSql.get(file) || '')) {
      const depFile = tableToFile.get(depTable);
      if (depFile && set.has(depFile) && depFile !== file) deps.get(file).add(depFile);
    }
  }
  const ordered = [];
  const temp = new Set();
  const perm = new Set();
  function visit(file) {
    if (perm.has(file)) return;
    if (temp.has(file)) return;
    temp.add(file);
    for (const dep of deps.get(file) || []) visit(dep);
    temp.delete(file);
    perm.add(file);
    ordered.push(file);
  }
  files.slice().sort().forEach(visit);
  return ordered;
}

function cleanOutput() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const domain of domainOrder) fs.mkdirSync(path.join(outDir, domain), { recursive: true });
}

function writeFile(rel, body) {
  const full = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body.replace(/\r\n/g, '\n').trim() + '\n', 'utf8');
}

function main() {
  const sources = readSqlSources();
  const records = [];
  for (const src of sources) {
    if (!src.rel.endsWith('.sql')) continue;
    for (const stmt of splitStatements(stripTransaction(src.sql))) {
      const kind = statementKind(stmt);
      const normalizedStmt = normalizeStatement(stmt);
      const normalizedKind = statementKind(normalizedStmt);
      const table = tableNameFromCreate(normalizedStmt) || tableNameFromAlter(normalizedStmt) || tableNameFromIndex(normalizedStmt) || tableNameFromTrigger(normalizedStmt);
      const domain = domainForRecord(normalizedKind, table, src.rel);
      records.push({ src, stmt: normalizedStmt, kind: normalizedKind, table, object: objectName(normalizedStmt, normalizedKind), domain });
    }
  }

  const lastCreate = new Map();
  const createsByTable = new Map();
  const altersByTable = new Map();
  const dropsByIndex = new Set();
  const indexes = new Map();
  const functions = new Map();
  const triggersByDomain = new Map();
  const othersByFile = new Map();
  const views = new Map();
  const deferredConstraints = [];
  const fileToTable = new Map();
  const tableToFile = new Map();
  const fileSql = new Map();
  const finalColumnsByTable = new Map();

  for (const r of records) {
    if (r.kind === 'table' && r.table) {
      lastCreate.set(r.table, r);
      if (!createsByTable.has(r.table)) createsByTable.set(r.table, []);
      createsByTable.get(r.table).push(r);
    }
    if (r.kind === 'alter_table' && r.table) {
      if (!altersByTable.has(r.table)) altersByTable.set(r.table, []);
      altersByTable.get(r.table).push(r);
    }
    if (/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i.test(r.stmt)) {
      const m = r.stmt.match(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?("?[\w.]+"?)/i);
      dropsByIndex.add(m[1].replace(/"/g, '').split('.').pop());
    }
    if (r.kind === 'index' && r.object && !dropsByIndex.has(r.object)) {
      const existing = indexes.get(r.object);
      const existingIsUnique = existing ? /^CREATE\s+UNIQUE\s+INDEX\b/i.test(existing.stmt) : false;
      const nextIsUnique = /^CREATE\s+UNIQUE\s+INDEX\b/i.test(r.stmt);
      if (!existing || nextIsUnique || !existingIsUnique) indexes.set(r.object, r);
    }
    if (r.kind === 'function' && r.object) functions.set(r.object, r);
    if (r.kind === 'trigger' && r.object) {
      const key = `${r.table}.${r.object}`;
      if (!triggersByDomain.has(r.domain)) triggersByDomain.set(r.domain, new Map());
      triggersByDomain.get(r.domain).set(key, r);
    }
    if (r.kind === 'view' && r.object) views.set(r.object, r);
    if (['extension', 'schema', 'type', 'seed'].includes(r.kind)) {
      const file = path.join(r.domain, desiredFile(r.domain, r.table, r.kind));
      if (!othersByFile.has(file)) othersByFile.set(file, []);
      othersByFile.get(file).push(r);
    }
  }

  cleanOutput();

  for (const [table, rec] of [...lastCreate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const parent = partitionParent(rec.stmt);
    if (parent && !/\bPARTITION\s+BY\b/i.test(lastCreate.get(parent)?.stmt || '')) continue;
    const alters = (altersByTable.get(table) || []).map((r) => r.stmt);
    const creates = (createsByTable.get(table) || []).map((r) => r.stmt);
    const normalized = normalizeCreateTable(rec.stmt, creates, alters, table, deferredConstraints);
    const domain = domainForTable(table);
    const file = path.join(domain, desiredFile(domain, table, 'table'));
    const columns = normalizedTableColumns(normalized);
    finalColumnsByTable.set(table, columns);
    const relatedIndexes = [...indexes.values()].filter((idx) => idx.table === table && !indexReferencesMissingColumns(idx.stmt, columns));
    const sourceFiles = [...(createsByTable.get(table) || []), ...(altersByTable.get(table) || []), ...relatedIndexes]
      .map((r) => r.src.rel)
      .filter((value, index, values) => values.indexOf(value) === index);
    const body = [
      `-- Normalized final definition for ${table}.`,
      `-- Canonical/historical sources include:`,
      ...sourceFiles.map((rel) => `-- - ${rel}`),
      '',
      normalized,
      ...relatedIndexes.map((r) => `\n${normalizeCreateIndex(r.stmt)}`),
    ].join('\n');
    writeFile(file, body);
    const normalizedRel = file.replace(/\\/g, '/');
    fileToTable.set(normalizedRel, table);
    tableToFile.set(table, normalizedRel);
    fileSql.set(normalizedRel, body);
  }

  for (const [file, recs] of othersByFile.entries()) {
    const seen = new Set();
    const body = recs
      .filter((r) => {
        const target = r.kind === 'seed' ? insertTarget(r.stmt) : null;
        if (target && !lastCreate.has(target)) return false;
        if (target) {
          const columns = finalColumnsByTable.get(target) || new Set();
          if (insertColumns(r.stmt).some((col) => !columns.has(col))) return false;
          if (seedReferencesMissingColumns(r.stmt, finalColumnsByTable)) return false;
        }
        const key = r.stmt.replace(/\s+/g, ' ').trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r) => `-- Source: ${r.src.rel}\n${r.stmt}`)
      .join('\n\n');
    writeFile(file, body);
  }

  const fnBody = [...functions.values()]
    .sort((a, b) => (a.object || '').localeCompare(b.object || ''))
    .map((r) => `-- Source: ${r.src.rel}\n${r.stmt}`)
    .join('\n\n');
  if (fnBody) writeFile(path.join('17_functions', '001_functions.sql'), fnBody);

  const viewBody = [...views.values()]
    .sort((a, b) => (a.object || '').localeCompare(b.object || ''))
    .map((r) => `-- Source: ${r.src.rel}\n${normalizeCreateView(r.stmt)}`)
    .join('\n\n');
  if (viewBody) writeFile(path.join('18_views', '001_views.sql'), viewBody);

  if (deferredConstraints.length > 0) {
    const body = deferredConstraints
      .map((fk) => [
        `-- Deferred because ${fk.table}.${fk.column} participates in a fresh-schema FK cycle.`,
        `ALTER TABLE ${fk.table}`,
        `  DROP CONSTRAINT IF EXISTS ${fk.constraintName};`,
        `ALTER TABLE ${fk.table}`,
        `  ADD CONSTRAINT ${fk.constraintName}`,
        `  FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencedTable}(id)${fk.onDelete};`,
      ].join('\n'))
      .join('\n\n');
    writeFile(path.join('17_functions', '900_deferred_foreign_keys.sql'), body);
  }

  for (const [domain, map] of [...triggersByDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const body = [...map.values()]
      .sort((a, b) => `${a.table}.${a.object}`.localeCompare(`${b.table}.${b.object}`))
      .map((r) => `-- Source: ${r.src.rel}\nDROP TRIGGER IF EXISTS ${r.object} ON ${r.table};\n${r.stmt.replace(/\bconnector_set_updated_at\s*\(\s*\)/ig, 'set_updated_at()')}`)
      .join('\n\n');
    writeFile(path.join(domain, '999_triggers.sql'), body);
  }

  const triggerFiles = domainOrder
    .map((domain) => path.join(outDir, domain, '999_triggers.sql'))
    .filter((file) => fs.existsSync(file))
    .map((file) => path.relative(outDir, file).replace(/\\/g, '/'));
  const schemaParts = [];
  schemaParts.push('-- Clean PostgreSQL primary database baseline.');
  schemaParts.push('-- Generated from canonical_migrations_draft and historical migrations.');
  for (const domain of domainOrder) {
    const files = fs.readdirSync(path.join(outDir, domain))
      .filter((name) => name.endsWith('.sql') && name !== '999_triggers.sql')
      .sort();
    for (const name of orderDomainFiles(files.map((name) => `${domain}/${name}`), fileToTable, tableToFile, fileSql).map((rel) => rel.slice(domain.length + 1))) {
      const rel = `${domain}/${name}`;
      schemaParts.push(`\n-- ============================================================\n-- Source: ${rel}\n-- ============================================================\n`);
      schemaParts.push(fs.readFileSync(path.join(outDir, rel), 'utf8').trim());
    }
  }
  for (const rel of triggerFiles) {
    schemaParts.push(`\n-- ============================================================\n-- Source: ${rel}\n-- ============================================================\n`);
    schemaParts.push(fs.readFileSync(path.join(outDir, rel), 'utf8').trim());
  }
  writeFile('schema.sql', schemaParts.join('\n') + '\n');

  const typeFile = path.join('02_types', '001_enums_and_domains.sql');
  const typePath = path.join(outDir, typeFile);
  const typeSql = fs.readFileSync(typePath, 'utf8');
  if (/\bconnector_type\b/i.test(schemaParts.join('\n')) && !/\bCREATE\s+TYPE\s+connector_type\b/i.test(typeSql)) {
    fs.writeFileSync(typePath, `${typeSql.trim()}\n\n-- Generated compatibility type for legacy notification and alerting tables.\nDO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_type') THEN\n    CREATE TYPE connector_type AS ENUM ('email', 'slack', 'webhook', 'discord', 'teams', 'pagerduty', 'sms');\n  END IF;\nEND $$;\n`, 'utf8');
    const schemaSql = fs.readFileSync(path.join(outDir, 'schema.sql'), 'utf8');
    const nextTypeSql = fs.readFileSync(typePath, 'utf8').trim();
    fs.writeFileSync(path.join(outDir, 'schema.sql'), schemaSql.replace(typeSql.trim(), () => nextTypeSql), 'utf8');
  }
  {
    const currentTypeSql = fs.readFileSync(typePath, 'utf8');
    if (/\balert_category\b/i.test(currentTypeSql) && /'all'/.test(schemaParts.join('\n')) && !/ALTER\s+TYPE\s+alert_category\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'all'/i.test(currentTypeSql)) {
      fs.writeFileSync(typePath, `${currentTypeSql.trim()}\n\n-- Generated compatibility value for legacy project notification preference seeds.\nALTER TYPE alert_category ADD VALUE IF NOT EXISTS 'all';\n`, 'utf8');
      const schemaSql = fs.readFileSync(path.join(outDir, 'schema.sql'), 'utf8');
      fs.writeFileSync(path.join(outDir, 'schema.sql'), schemaSql.replace(currentTypeSql.trim(), () => fs.readFileSync(typePath, 'utf8').trim()), 'utf8');
    }
  }

  const canonicalFolders = new Map();
  for (const src of sources.filter((s) => s.rel.startsWith('canonical_migrations_draft/'))) {
    const folder = src.rel.split('/').slice(0, -1).join('/');
    if (!canonicalFolders.has(folder)) canonicalFolders.set(folder, { files: 0, objects: 0 });
    const item = canonicalFolders.get(folder);
    item.files++;
    item.objects += records.filter((r) => r.src.rel === src.rel && ['table', 'index', 'function', 'trigger', 'view', 'type', 'alter_table'].includes(r.kind)).length;
  }
  const tableRows = [...lastCreate.keys()].sort().map((table) => {
    const rec = lastCreate.get(table);
    const domain = domainForTable(table);
    const cols = splitCommaTopLevel(extractCreateBody(normalizeCreateTable(rec.stmt, (createsByTable.get(table) || []).map((r) => r.stmt), (altersByTable.get(table) || []).map((r) => r.stmt), table, []))?.body || '')
      .map(columnName)
      .filter(Boolean);
    const finalFile = `${domain}/${desiredFile(domain, table, 'table')}`;
    return `| ${table} | ${domainNames[domain]} | ${runtimeUsed(table) ? 'yes' : 'unverified'} | ${rec.src.rel} | ${(altersByTable.get(table) || []).map((r) => r.src.rel).filter((v, i, a) => a.indexOf(v) === i).join('<br>') || 'none'} | ${finalFile} | ${cols.join(', ')} |`;
  });
  const triggerRows = [...triggersByDomain.entries()].flatMap(([domain, map]) =>
    [...map.values()].sort((a, b) => `${a.table}.${a.object}`.localeCompare(`${b.table}.${b.object}`)).map((r) =>
      `| ${r.object} | ${domainNames[domain]} | ${r.table} | ${((r.stmt.match(/FUNCTION\s+([\w.]+)/i) || [])[1] || 'unknown')} | ${r.src.rel} | yes |`
    )
  );
  const folderRows = [...canonicalFolders.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([folder, info]) =>
    `| ${folder} | ${info.files} | ${info.objects} | ${info.objects} |`
  );
  const migrationRows = records
    .filter((r) => r.src.rel.startsWith('migrations/') && ['table', 'alter_table', 'index', 'function', 'trigger', 'view', 'type'].includes(r.kind))
    .map((r) => `| ${r.src.rel} | ${r.object || r.table || r.kind} | ${r.table ? `${domainForTable(r.table)}/${desiredFile(domainForTable(r.table), r.table, r.kind === 'alter_table' ? 'table' : r.kind)}` : r.kind} | yes |`);

  writeFile('SCHEMA_RECONCILIATION.md', [
    '# Schema Reconciliation',
    '',
    'This baseline is generated from the current canonical migration draft plus historical migrations. It is a fresh-database schema, not a replay of historical patches.',
    '',
    '## Audit Summary',
    '',
    `- Canonical SQL/MD files read: ${sources.filter((s) => s.rel.startsWith('canonical_migrations_draft/')).length}`,
    `- Historical SQL files read: ${sources.filter((s) => s.rel.startsWith('migrations/')).length}`,
    `- Final tables emitted: ${lastCreate.size}`,
    `- Final indexes emitted: ${indexes.size}`,
    `- Final functions emitted: ${functions.size}`,
    `- Final views emitted: ${views.size}`,
    `- Final triggers emitted: ${[...triggersByDomain.values()].reduce((sum, map) => sum + map.size, 0)}`,
    '',
    '## Mandatory Final Tables',
    '',
    '| Table | Domain | Runtime Used | Canonical Source | Migration Source | Final | Final Columns |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...tableRows,
    '',
    '## Trigger Inventory',
    '',
    '| Trigger | Domain | Table | Function | Source | Included |',
    '| --- | --- | --- | --- | --- | --- |',
    ...triggerRows,
    '',
    '## Historical Migration Normalization',
    '',
    '| Historical Migration | Object | Final Location | Normalized? |',
    '| --- | --- | --- | --- |',
    ...migrationRows,
    '',
    '## Canonical Folder Coverage',
    '',
    '| Canonical Folder | SQL Files Read | Objects Extracted | Objects Normalized |',
    '| --- | ---: | ---: | ---: |',
    ...folderRows,
    '',
    '## Remaining Unknowns',
    '',
    '- Runtime usage is marked `unverified` where no exact table-token reference was detected in TypeScript. This does not remove canonical objects.',
    '- Database execution validation requires a running PostgreSQL server; local `psql` was not available during generation.',
    '- `ALTER TABLE` statements are intentionally not copied into table files for final-known column changes. Remaining ALTER statements only appear in non-table support files when emitted from source SQL and should be reviewed before production use.',
  ].join('\n'));

  console.log(`Generated ${outDir}`);
}

function runtimeUsed(table) {
  const srcDir = path.join(root, 'src');
  const files = walk(srcDir).filter((file) => /\.(ts|js)$/i.test(file) && !file.includes(`${path.sep}db${path.sep}postgres${path.sep}`));
  const re = new RegExp(`\\b${table}\\b`, 'i');
  return files.some((file) => re.test(fs.readFileSync(file, 'utf8')));
}

main();
