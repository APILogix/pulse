const fs = require('fs');
const path = require('path');

const root = process.cwd();
const seedDir = path.join(root, 'src/db/postgres/canonical_migrations_draft/11_billing/seeder');
const outFile = path.join(root, 'docs/billing-seed-preview.html');

const featureFiles = [
  '028a_seed_billing_features_core.sql',
  '028a2_seed_billing_features_projects.sql',
  '028a3_seed_billing_features_sdk.sql',
  '028b1_seed_billing_features_error_tracking.sql',
  '028b2_seed_billing_features_tracing.sql',
  '028b3_seed_billing_features_logging.sql',
  '028b4_seed_billing_features_metrics.sql',
  '028b5_seed_billing_features_profiling.sql',
  '028b6_seed_billing_features_session_replay.sql',
  '028b7_seed_billing_features_uptime_cron.sql',
  '028c1_seed_billing_features_alerting.sql',
  '028c2_seed_billing_features_dashboards.sql',
  '028c3_seed_billing_features_integrations.sql',
  '028c4_seed_billing_features_ai.sql',
  '028d1_seed_billing_features_enterprise_security.sql',
];

const entitlementFiles = [
  '030a_seed_plan_entitlements_core.sql',
  '030b_seed_plan_entitlements_observability.sql',
  '030c_seed_plan_entitlements_platform.sql',
  '030d_seed_plan_quota_values.sql',
];

function readSeed(file) {
  return fs.readFileSync(path.join(seedDir, file), 'utf8');
}

function splitTopLevelTuples(valuesSql) {
  const tuples = [];
  let inQuote = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < valuesSql.length; i += 1) {
    const char = valuesSql[i];
    const next = valuesSql[i + 1];

    if (char === "'" && inQuote && next === "'") {
      i += 1;
      continue;
    }
    if (char === "'") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;

    if (char === '(') {
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesSql.slice(start, i));
        start = -1;
      }
    }
  }

  return tuples;
}

function splitColumns(tupleSql) {
  const columns = [];
  let inQuote = false;
  let depth = 0;
  let start = 0;

  for (let i = 0; i < tupleSql.length; i += 1) {
    const char = tupleSql[i];
    const next = tupleSql[i + 1];

    if (char === "'" && inQuote && next === "'") {
      i += 1;
      continue;
    }
    if (char === "'") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;

    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth -= 1;
    if (char === ',' && depth === 0) {
      columns.push(tupleSql.slice(start, i).trim());
      start = i + 1;
    }
  }
  columns.push(tupleSql.slice(start).trim());
  return columns.map(cleanSqlValue);
}

function cleanSqlValue(value) {
  const trimmed = value.trim();
  if (/^null\b/i.test(trimmed)) return null;
  if (/^true\b/i.test(trimmed)) return true;
  if (/^false\b/i.test(trimmed)) return false;
  const stringMatch = trimmed.match(/^'((?:''|[^'])*)'/);
  if (stringMatch) return stringMatch[1].replace(/''/g, "'");
  const numberMatch = trimmed.match(/^-?\d+/);
  if (numberMatch) return Number(numberMatch[0]);
  return trimmed.replace(/::[a-z_][a-z0-9_]*(\[\])?/gi, '');
}

function extractValuesBlock(sql, cteName) {
  const cte = sql.indexOf(`WITH ${cteName}`);
  const values = sql.indexOf('VALUES', cte);
  const insert = sql.indexOf('INSERT INTO', values);
  return sql.slice(values + 'VALUES'.length, insert);
}

function rowsFromSeed(file, cteName) {
  return splitTopLevelTuples(extractValuesBlock(readSeed(file), cteName)).map(splitColumns);
}

const plans = splitTopLevelTuples(readSeed('026_seed_plans.sql').split('VALUES')[1].split('ON CONFLICT')[0])
  .map(splitColumns)
  .map(([key, version, name, tier, description, trialDays, active, isPublic, customizable, nextPlan, badge, sortOrder]) => ({
    key, version, name, tier, description, trialDays, active, isPublic, customizable, nextPlan, badge, sortOrder,
  }))
  .sort((a, b) => a.sortOrder - b.sortOrder);

const prices = rowsFromSeed('027_seed_plan_prices.sql', 'price_seed')
  .map(([planKey, version, provider, interval, currency, amountMinor, isDefault, metadata]) => ({
    planKey, version, provider, interval, currency, amountMinor, isDefault, metadata,
  }));

const features = featureFiles.flatMap((file) => rowsFromSeed(file, 'feature_seed')
  .map(([key, name, description, category, module, valueType, usageBehavior, configuration, isPublic, isModuleRoot]) => ({
    file, key, name, description, category, module, valueType, usageBehavior, configuration, isPublic, isModuleRoot,
  })));

const entitlements = entitlementFiles.flatMap((file) => rowsFromSeed(file, 'entitlement_seed')
  .map(([planKey, featureKey, booleanValue, integerValue]) => ({
    file, planKey, featureKey, value: booleanValue === null ? integerValue : booleanValue,
  })));

const addons = rowsFromSeed('031b_seed_addon_catalog_canonical.sql', 'addon_seed')
  .map(([key, name, description, category, targetFeatureKey, amountMinor, unitQuantity, unitLabel]) => ({
    key, name, description, category, targetFeatureKey, amountMinor, unitQuantity, unitLabel,
  }));

const featureByKey = Object.fromEntries(features.map((feature) => [feature.key, feature]));
const entitlementsByPlan = Object.fromEntries(plans.map((plan) => [plan.key, {}]));
for (const entitlement of entitlements) {
  entitlementsByPlan[entitlement.planKey][entitlement.featureKey] = entitlement.value;
}

function money(amountMinor) {
  if (amountMinor === 0) return '$0';
  return `$${(amountMinor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function renderValue(value) {
  if (value === true) return '<span class="yes">Included</span>';
  if (value === false) return '<span class="no">Not included</span>';
  if (value === -1) return '<span class="yes">Unlimited</span>';
  if (value === null || value === undefined) return '<span class="muted">-</span>';
  return escapeHtml(Number(value).toLocaleString('en-US'));
}

function renderPlanPrice(planKey) {
  return prices
    .filter((price) => price.planKey === planKey)
    .map((price) => `${money(price.amountMinor)} / ${escapeHtml(price.interval)}${price.isDefault ? ' default' : ''}`)
    .join('<br>');
}

function groupedFeatures() {
  const groups = {};
  for (const feature of features) {
    const key = `${feature.module || 'general'} / ${feature.category}`;
    groups[key] ||= [];
    groups[key].push(feature);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Billing Seed Catalog Preview</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --surface: #ffffff;
      --surface-2: #f0f3f8;
      --text: #111827;
      --muted: #667085;
      --border: #d9e0ea;
      --accent: #2563eb;
      --good: #067647;
      --bad: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    header {
      padding: 28px 32px 18px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 28px 0 12px; font-size: 20px; letter-spacing: 0; }
    h3 { margin: 0 0 10px; font-size: 15px; letter-spacing: 0; }
    main { padding: 24px 32px 48px; }
    .summary { display: flex; flex-wrap: wrap; gap: 10px; color: var(--muted); }
    .pill { background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 6px 10px; font-size: 13px; }
    .grid { display: grid; grid-template-columns: repeat(5, minmax(210px, 1fr)); gap: 12px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; min-width: 0; }
    .plan-title { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
    .badge { color: var(--accent); font-size: 12px; font-weight: 700; }
    .price { font-size: 18px; font-weight: 700; margin: 10px 0; }
    .desc { color: var(--muted); font-size: 13px; min-height: 58px; }
    .table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
    table { width: 100%; border-collapse: collapse; min-width: 900px; }
    th, td { border-bottom: 1px solid var(--border); padding: 9px 10px; text-align: left; vertical-align: top; font-size: 13px; }
    th { background: var(--surface-2); position: sticky; top: 94px; z-index: 1; }
    tr:last-child td { border-bottom: 0; }
    code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; }
    .muted { color: var(--muted); }
    .yes { color: var(--good); font-weight: 700; }
    .no { color: var(--bad); }
    .group { margin-bottom: 16px; }
    .group-title { margin: 18px 0 8px; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
    @media (max-width: 1200px) { .grid { grid-template-columns: repeat(2, minmax(240px, 1fr)); } }
    @media (max-width: 720px) {
      header, main { padding-left: 16px; padding-right: 16px; }
      .grid { grid-template-columns: 1fr; }
      th { top: 132px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Billing Seed Catalog Preview</h1>
    <div class="summary">
      <span class="pill">${plans.length} plans</span>
      <span class="pill">${prices.length} prices</span>
      <span class="pill">${features.length} seeded features</span>
      <span class="pill">${entitlements.length} entitlement rows</span>
      <span class="pill">${addons.length} add-ons</span>
      <span class="pill">Generated from canonical billing seeder SQL</span>
    </div>
  </header>
  <main>
    <section>
      <h2>Plans</h2>
      <div class="grid">
        ${plans.map((plan) => `<article class="card">
          <div class="plan-title">
            <h3>${escapeHtml(plan.name)}</h3>
            ${plan.badge ? `<span class="badge">${escapeHtml(plan.badge)}</span>` : ''}
          </div>
          <div class="price">${renderPlanPrice(plan.key)}</div>
          <p class="desc">${escapeHtml(plan.description)}</p>
          <div class="muted">Trial: ${plan.trialDays} days</div>
          <div class="muted">Public: ${plan.isPublic ? 'yes' : 'no'} | Customizable: ${plan.customizable ? 'yes' : 'no'}</div>
        </article>`).join('')}
      </div>
    </section>

    <section>
      <h2>Plan Entitlement Matrix</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Module</th>
              <th>Type</th>
              ${plans.map((plan) => `<th>${escapeHtml(plan.name)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${features.map((feature) => `<tr>
              <td><code>${escapeHtml(feature.key)}</code><br><span class="muted">${escapeHtml(feature.name)}</span></td>
              <td>${escapeHtml(feature.module)}</td>
              <td>${escapeHtml(feature.valueType)}<br><span class="muted">${escapeHtml(feature.usageBehavior)}</span></td>
              ${plans.map((plan) => `<td>${renderValue(entitlementsByPlan[plan.key][feature.key])}</td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Feature Catalog</h2>
      ${groupedFeatures().map(([group, groupFeatures]) => `<div class="group">
        <div class="group-title">${escapeHtml(group)} (${groupFeatures.length})</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Key</th><th>Name</th><th>Description</th><th>Behavior</th><th>Seed File</th></tr></thead>
            <tbody>
              ${groupFeatures.map((feature) => `<tr>
                <td><code>${escapeHtml(feature.key)}</code></td>
                <td>${escapeHtml(feature.name)}</td>
                <td>${escapeHtml(feature.description)}</td>
                <td>${escapeHtml(feature.valueType)} / ${escapeHtml(feature.usageBehavior)}</td>
                <td><code>${escapeHtml(feature.file)}</code></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`).join('')}
    </section>

    <section>
      <h2>Add-Ons</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Add-On</th><th>Description</th><th>Targets Feature</th><th>Price</th><th>Quantity</th></tr></thead>
          <tbody>
            ${addons.map((addon) => `<tr>
              <td><code>${escapeHtml(addon.key)}</code><br>${escapeHtml(addon.name)}</td>
              <td>${escapeHtml(addon.description)}</td>
              <td><code>${escapeHtml(addon.targetFeatureKey)}</code><br><span class="muted">${escapeHtml(featureByKey[addon.targetFeatureKey]?.name || '')}</span></td>
              <td>${money(addon.amountMinor)} monthly</td>
              <td>${escapeHtml(Number(addon.unitQuantity).toLocaleString('en-US'))} ${escapeHtml(addon.unitLabel)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>
  </main>
</body>
</html>`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);

console.log(`Generated ${path.relative(root, outFile)}`);
console.log(JSON.stringify({
  plans: plans.length,
  prices: prices.length,
  features: features.length,
  entitlements: entitlements.length,
  addons: addons.length,
}, null, 2));
