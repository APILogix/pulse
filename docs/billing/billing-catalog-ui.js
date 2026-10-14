const sources = {
  v2: {
    label: "Canonical v2",
    url: "./billing-plans.json",
    getPlans: (catalog) => catalog.plans ?? [],
  },
  v3: {
    label: "Finite-quota v3",
    url: "./billing-enterprise-catalog-v3.json",
    getPlans: (catalog) => catalog.plans_v3 ?? [],
  },
};

const state = {
  source: "v2",
  interval: "monthly",
  section: "summary",
  query: "",
  activePlanKey: null,
  catalogs: {},
  canonicalPlans: null,
  plans: [],
  redesignCatalog: null,
  addonsCatalog: null,
  drawerTab: "redesign",
  drawerPlanKey: null,
};

const el = {
  source: document.querySelector("#catalogSource"),
  meta: document.querySelector("#catalogMeta"),
  cards: document.querySelector("#planCards"),
  search: document.querySelector("#catalogSearch"),
  planTier: document.querySelector("#activePlanTier"),
  planName: document.querySelector("#activePlanName"),
  planPrice: document.querySelector("#activePlanPrice"),
  planDescription: document.querySelector("#activePlanDescription"),
  summary: document.querySelector("#summaryGrid"),
  detail: document.querySelector("#detailContent"),
  json: document.querySelector("#jsonView"),
  copy: document.querySelector("#copyJson"),
  drawer: document.querySelector("#redesignDrawer"),
  drawerTitle: document.querySelector("#drawerTitle"),
  drawerSubtitle: document.querySelector("#drawerSubtitle"),
  drawerContent: document.querySelector("#drawerContent"),
  copyProposal: document.querySelector("#copyProposal"),
};

async function loadSource(sourceKey) {
  if (!state.catalogs[sourceKey]) {
    const response = await fetch(sources[sourceKey].url);
    if (!response.ok) {
      throw new Error(`Unable to load ${sources[sourceKey].url}`);
    }
    state.catalogs[sourceKey] = await response.json();
  }

  const catalog = state.catalogs[sourceKey];
  state.plans = normalizePlans(sources[sourceKey].getPlans(catalog));
  state.activePlanKey = state.plans.some((plan) => plan.key === state.activePlanKey)
    ? state.activePlanKey
    : state.plans[0]?.key;
  el.meta.textContent = `${sources[sourceKey].label} · schema ${catalog.schema_version ?? "n/a"} · version ${
    catalog.catalog_version ?? "n/a"
  }`;
  render();
}

function normalizePlans(plans) {
  return plans
    .map((plan, index) => {
      const key = plan.key ?? plan.plan_key ?? plan.id ?? `plan-${index}`;
      const prices = normalizePrices(plan.prices);
      const quotas = normalizeEntries(plan.quotas ?? plan.quota_overrides ?? plan.limits ?? {});
      const features = normalizeEntries(plan.features ?? plan.entitlements ?? {});
      const integrations = normalizeEntries(plan.integrations ?? plan.connectors ?? {});
      const eventQuotas = normalizeEntries(plan.event_quotas ?? plan.signal_quotas ?? {});

      return {
        raw: plan,
        key,
        name: plan.name ?? titleize(key),
        tier: plan.tier ?? key,
        description: plan.description ?? plan.positioning ?? plan.summary ?? "",
        badge: plan.badge ?? plan.metadata?.badge ?? (plan.metadata?.recommendedFor ? "Fit" : null),
        sort: plan.sort_order ?? index,
        prices,
        quotas: quotas.length ? quotas : eventQuotas,
        features,
        integrations,
        eventQuotas,
        creditPool: plan.monthly_event_credit_pool ?? plan.monthly_credit_pool ?? plan.included_monthly_credits,
      };
    })
    .sort((a, b) => a.sort - b.sort);
}

function normalizePrices(prices) {
  if (Array.isArray(prices)) {
    return Object.fromEntries(prices.map((price) => [price.interval ?? "monthly", price]));
  }
  if (prices && typeof prices === "object") {
    return prices;
  }
  return {};
}

function normalizeEntries(collection) {
  if (Array.isArray(collection)) {
    return collection.map((item, index) => normalizeEntry(item.key ?? item.feature_key ?? item.name ?? `item-${index}`, item));
  }
  if (collection && typeof collection === "object") {
    return Object.entries(collection).map(([key, value]) => normalizeEntry(key, value));
  }
  return [];
}

function normalizeEntry(key, value) {
  const item = value && typeof value === "object" ? value : { value };
  return {
    key,
    name: item.name ?? item.title ?? titleize(key),
    value: item.value ?? item.limit ?? item.integer_value ?? item.string_value ?? item.enabled ?? item.is_enabled,
    display: item.display_value ?? item.display ?? item.value_label,
    unit: item.unit ?? item.units ?? "",
    scope: item.scope ?? item.category ?? item.module ?? "",
    enforcement: item.enforcement_type ?? item.enforcementType ?? item.usage_behavior ?? "",
    raw: item,
  };
}

function render() {
  const active = state.plans.find((plan) => plan.key === state.activePlanKey) ?? state.plans[0];
  renderCards(active);
  if (!active) return;

  el.planTier.textContent = active.tier;
  el.planName.textContent = active.name;
  el.planPrice.textContent = formatPrice(active.prices[state.interval] ?? active.prices.monthly);
  el.planDescription.textContent = active.description;
  el.summary.innerHTML = renderSummary(active);
  el.json.textContent = JSON.stringify(active.raw, null, 2);
  renderDetail(active);
}

function renderCards(active) {
  el.cards.innerHTML = state.plans
    .map((plan) => {
      const price = formatPrice(plan.prices[state.interval] ?? plan.prices.monthly);
      const badge = plan.badge ? `<span class="badge">${escapeHtml(String(plan.badge))}</span>` : "";
      return `
        <button type="button" class="plan-card ${plan.key === active?.key ? "is-active" : ""}" data-plan="${escapeHtml(plan.key)}" aria-label="Open ${escapeHtml(plan.name)} plan redesign">
          <span class="plan-top">
            <h3>${escapeHtml(plan.name)}</h3>
            ${badge}
          </span>
          <span class="plan-price">${escapeHtml(price)}</span>
          <span class="plan-description">${escapeHtml(plan.description)}</span>
        </button>
      `;
    })
    .join("");
}

function renderSummary(plan) {
  const enabledFeatures = plan.features.filter((item) => item.value === true || item.raw?.is_enabled === true).length;
  const enabledIntegrations = plan.integrations.filter((item) => item.value === true || item.raw?.is_enabled === true).length;
  const metrics = [
    ["Monthly credits", formatValue(plan.creditPool, "credits")],
    ["Quotas", plan.quotas.length],
    ["Enabled features", enabledFeatures || "n/a"],
    ["Integrations", enabledIntegrations || plan.integrations.length || "n/a"],
  ];
  return metrics
    .map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`)
    .join("");
}

function renderDetail(plan) {
  if (state.section === "json") {
    el.detail.innerHTML = `<div class="empty-state">The full selected plan JSON is shown in the right panel.</div>`;
    return;
  }

  if (state.section === "summary") {
    el.detail.innerHTML = [
      ...renderRows("Key quotas", plan.quotas.slice(0, 12)),
      ...renderRows("Enabled features", plan.features.filter((item) => item.value === true || item.raw?.is_enabled === true).slice(0, 12)),
    ].join("");
    return;
  }

  const items = filterItems(plan[state.section] ?? []);
  el.detail.innerHTML = renderRows(titleize(state.section), items).join("") || `<div class="empty-state">No matching catalog entries.</div>`;
}

function renderRows(title, items) {
  const filtered = filterItems(items);
  if (!filtered.length) return [];
  return [
    `<p class="eyebrow">${escapeHtml(title)}</p>`,
    ...filtered.map((item) => {
      const value = formatEntryValue(item);
      const className = value === "Off" ? "off" : typeof item.value === "number" ? "limit" : "";
      return `
        <div class="row">
          <span class="row-name">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.key)}</span>
          </span>
          <span class="value-pill ${className}">${escapeHtml(value)}</span>
          <span class="row-meta">${escapeHtml([item.scope, item.enforcement].filter(Boolean).join(" · ") || "catalog entry")}</span>
        </div>
      `;
    }),
  ];
}

function filterItems(items) {
  if (!state.query) return items;
  const needle = state.query.toLowerCase();
  return items.filter((item) => JSON.stringify(item.raw).toLowerCase().includes(needle) || item.key.toLowerCase().includes(needle));
}

function formatPrice(price) {
  if (!price) return "Custom";
  if (price.metadata?.display) return price.metadata.display;
  if (typeof price === "string") return price;
  if (price.display) return price.display;
  if (price.contactSales) return "Contact Sales";
  const amount = price.amountMinor ?? price.amount_minor ?? price.amount_cents;
  if (typeof amount === "number") {
    return amount === 0 ? "$0" : `$${(amount / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}/${price.interval ?? state.interval}`;
  }
  return "Custom";
}

function formatEntryValue(item) {
  if (item.display !== undefined) return String(item.display);
  if (item.value === true) return "On";
  if (item.value === false) return "Off";
  return formatValue(item.value, item.unit);
}

function formatValue(value, unit) {
  if (value === undefined || value === null) return "n/a";
  if (typeof value === "number") return `${value.toLocaleString()}${unit ? ` ${unit}` : ""}`;
  return `${value}${unit && value !== "Custom" ? ` ${unit}` : ""}`;
}

function titleize(value) {
  return String(value).replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

document.querySelectorAll("[data-interval]").forEach((button) => {
  button.addEventListener("click", () => {
    state.interval = button.dataset.interval;
    document.querySelectorAll("[data-interval]").forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  });
});

document.querySelectorAll("[data-section]").forEach((button) => {
  button.addEventListener("click", () => {
    state.section = button.dataset.section;
    document.querySelectorAll("[data-section]").forEach((item) => item.classList.toggle("is-active", item === button));
    render();
  });
});

el.cards.addEventListener("click", (event) => {
  const card = event.target.closest("[data-plan]");
  if (!card) return;
  state.activePlanKey = card.dataset.plan;
  render();
  openRedesignDrawer(card.dataset.plan);
});

async function loadRedesignData() {
  if (state.redesignCatalog && state.addonsCatalog) return;
  const [redesignResponse, addonsResponse, canonicalResponse] = await Promise.all([
    fetch("./billing-catalog-redesign-v4.json"),
    fetch("./billing-addons-and-promotions.json"),
    state.catalogs.v2 ? Promise.resolve(null) : fetch("./billing-plans.json"),
  ]);
  if (!redesignResponse.ok || !addonsResponse.ok || (canonicalResponse && !canonicalResponse.ok)) throw new Error("Unable to load redesign or add-on catalog.");
  [state.redesignCatalog, state.addonsCatalog] = await Promise.all([redesignResponse.json(), addonsResponse.json()]);
  if (canonicalResponse) state.catalogs.v2 = await canonicalResponse.json();
  state.canonicalPlans = normalizePlans(sources.v2.getPlans(state.catalogs.v2));
}

async function openRedesignDrawer(planKey) {
  state.drawerPlanKey = planKey;
  state.drawerTab = "redesign";
  try {
    await loadRedesignData();
    renderDrawer();
    el.drawer.showModal();
  } catch (error) {
    el.drawerContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    el.drawer.showModal();
  }
}

function renderDrawer() {
  const current = state.canonicalPlans?.find((plan) => plan.key === state.drawerPlanKey);
  const proposed = state.redesignCatalog?.plans?.find((plan) => plan.key === state.drawerPlanKey);
  const enterprise = state.redesignCatalog?.plans?.find((plan) => plan.key === "enterprise");
  if (!current || !proposed || !enterprise) return;

  el.drawerTitle.textContent = `${current.name} plan`;
  el.drawerSubtitle.textContent = "Canonical billing v2 compared with the proposed credit-first v4 catalog. All usage is finite, metered, and bounded.";
  document.querySelectorAll("[data-drawer-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.drawerTab === state.drawerTab));

  if (state.drawerTab === "redesign") {
    const currentQuotas = current.raw.quotas ?? current.raw.limits ?? {};
    const proposedRows = Object.entries(proposed.quotas ?? {}).map(([key, value]) => {
      const old = currentQuotas[key];
      const oldValue = typeof old === "object" && old !== null ? old.value ?? old.limit ?? old.integer_value : old;
      return `<div class="compare-row"><span>${escapeHtml(quotaLabel(key))}</span><code>${escapeHtml(displayLimit(oldValue))}</code><strong>${escapeHtml(displayLimit(value, key))}</strong><small>${escapeHtml(key)}</small></div>`;
    }).join("");
    const price = proposed.key === "enterprise"
      ? "Custom contract"
      : `$${Number(proposed.prices?.monthly_usd ?? 0).toLocaleString()}/mo · provisional`;
    const annualPrice = proposed.key === "enterprise"
      ? "Annual commitment · negotiated"
      : `$${Number(proposed.prices?.annual_usd ?? 0).toLocaleString()}/year billed annually · provisional`;
    const eventCredits = proposed.quotas["quota.monthly_events"];
    const aiCredits = proposed.quotas["quota.ai_credits"];
    const productAccess = proposed.product_access ?? [];
    el.drawerContent.innerHTML = `
      <div class="proposal-banner"><span class="proposal-tag">PROPOSED · CREDIT-FIRST V4</span><strong>${escapeHtml(price)}</strong><p>${escapeHtml(annualPrice)} · ${escapeHtml(proposed.usage_policy)}</p></div>
      <div class="credit-summary"><div><span>Event credits / month</span><strong>${displayLimit(eventCredits)}</strong></div><div><span>AI credits / month</span><strong>${displayLimit(aiCredits)}</strong></div><div><span>Alert rules</span><strong>No org cap</strong></div><div><span>Daily alerts</span><strong>${displayLimit(proposed.quotas["quota.daily_alerts"])}</strong></div></div>
      <div class="drawer-callout"><strong>Credit and control model</strong><span>Telemetry consumes one weighted event-credit pool. AI consumes its own credit pool. Organization alert rules have no plan quota; each project, notification, integration delivery, connector, and channel remains bounded. Both pools reset monthly without rollover. No automatic postpaid overage is enabled.</span></div>
      <div class="drawer-callout margin-callout"><strong>Margin gate</strong><span>${escapeHtml(state.redesignCatalog.pricing_safety.pricing_formula)} A loss-free guarantee needs measured storage, query, integration, AI-route, and payment costs; these inputs are absent from the current catalog.</span></div>
      <div class="compare-head"><span>Quota</span><span>Current v2</span><span>Proposed v4</span></div>
      <div class="compare-list">${proposedRows}</div>
      ${renderAddonSection(current.key)}
      <section class="drawer-section"><h3>Removed or replaced</h3><div class="principle-list">${Object.entries(state.redesignCatalog.removed_or_replaced_entitlements).map(([key, description]) => `<div><strong>${escapeHtml(key)}</strong><span>${escapeHtml(description)}</span></div>`).join("")}</div></section>
      <section class="drawer-section"><h3>Included product access</h3><div class="tag-list">${productAccess.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div></section>
      ${renderEntitlementDetails(proposed)}`;
  } else if (state.drawerTab === "enterprise") {
    const enterpriseFeatures = Object.entries(enterprise.feature_entitlements ?? {}).filter(([key, value]) =>
      value !== false && value !== null && /^(security|support|compliance|deployment|dashboards|analytics|ai)\./.test(key)
    );
    const featureNames = new Map(state.canonicalPlans.find((plan) => plan.key === "enterprise").features.map((item) => [item.key, item.name]));
    const rows = Object.entries(enterprise.quotas ?? {}).map(([key, value]) => `<div class="enterprise-row"><span>${escapeHtml(quotaLabel(key))}</span><strong>${escapeHtml(displayLimit(value, key))}</strong><small>${escapeHtml(key)}</small></div>`).join("");
    el.drawerContent.innerHTML = `
      <div class="proposal-banner enterprise-banner"><span class="proposal-tag">UNIFIED RECOMMENDATION · ENTERPRISE</span><strong>Finite baseline · custom contract</strong><p>Use one enterprise offer across all accounts: explicit baseline, negotiated finite caps, and the same usage rules at every spend level.</p></div>
      <div class="enterprise-highlights"><div><span>Event credits / month</span><strong>${displayLimit(enterprise.quotas?.["quota.monthly_events"])}</strong></div><div><span>AI credits / month</span><strong>${displayLimit(enterprise.quotas?.["quota.ai_credits"])}</strong></div><div><span>Ingestion rate</span><strong>${displayLimit(enterprise.quotas?.["quota.requests_per_second"], "quota.requests_per_second")}</strong></div><div><span>Dashboards</span><strong>${displayLimit(enterprise.quotas?.["quota.dashboards"])}</strong></div><div><span>Retention</span><strong>${displayLimit(enterprise.quotas?.["quota.retention_days"], "quota.retention_days")}</strong></div><div><span>Stored data</span><strong>${displayLimit(enterprise.quotas?.["quota.retained_gb"], "quota.retained_gb")}</strong></div></div>
      <div class="drawer-callout"><strong>Enterprise commercial model</strong><span>Annual contract with finite included event and AI balances. Scale is delivered through measured, prepaid capacity packs or explicit finite contract overrides. Never promise unlimited volume or retention.</span></div>
      <div class="tag-list enterprise-feature-tags">${enterpriseFeatures.slice(0, 22).map(([key, value]) => `<span>${escapeHtml(featureNames.get(key) ?? titleize(key))}${typeof value === "string" ? ` · ${escapeHtml(value)}` : ""}</span>`).join("")}</div>
      <h3 class="drawer-section-title">Complete enterprise quota schedule</h3><div class="enterprise-list">${rows}</div>
      ${renderAddonSection("enterprise")}`;
  } else {
    el.drawerContent.innerHTML = `
      <div class="proposal-banner"><span class="proposal-tag">IMPLEMENTATION BACKLOG</span><strong>Catalog design requires runtime alignment</strong><p>These actions come from the billing audit and enterprise redesign docs.</p></div>
      <div class="change-list">
        <article><b>01</b><div><strong>Split event and AI ledgers</strong><p>Keep AI actions out of telemetry event weights; reserve and debit AI credits separately, including retries, cached responses, and model fallbacks.</p></div></article>
        <article><b>02</b><div><strong>Enforce finite usage stops</strong><p>Apply monthly and daily credits, RPS, retained GB, daily alert and integration deliveries, project alert rules, connectors, and channels in the actual request paths.</p></div></article>
        <article><b>03</b><div><strong>Replace ambiguous quotas</strong><p>Remove per-signal monthly event caps, organization alert-rule quota, duplicate monthly alert quota, and connector_sends. Retain explicit per-project rules and separate notification/delivery limits.</p></div></article>
        <article><b>04</b><div><strong>Make top-ups prepaid and margin-safe</strong><p>Resolve the $49 per 10M event-pack versus $0.50 per 1K overage conflict. Keep AI pack checkout disabled until route costs and the target margin establish a price floor.</p></div></article>
        <article><b>05</b><div><strong>Bound retention cost</strong><p>Enforce both retention days and retained GB. Meter or stop storage growth at the byte ceiling; retention days alone cannot bound storage COGS.</p></div></article>
        <article><b>06</b><div><strong>Reconcile runtime and billing</strong><p>Update seeders, entitlement aggregation, usage rollups, invoice preview, add-on lifecycle, downgrade behavior, admin overrides, and dashboards to use the same catalog version.</p></div></article>
      </div>
      <section class="drawer-section"><h3>Credit model decisions</h3><div class="principle-list">${state.redesignCatalog.principles.map((text, index) => `<div><strong>Decision ${index + 1}</strong><span>${escapeHtml(text)}</span></div>`).join("")}</div></section>
      <section class="drawer-section"><h3>Usage notifications</h3><div class="principle-list"><div><strong>Event and AI balances</strong><span>${escapeHtml(state.redesignCatalog.usage_notifications.event_and_ai_credit_thresholds_percent.join("%, ") + "% thresholds")}</span></div><div><strong>Daily delivery caps</strong><span>${escapeHtml(state.redesignCatalog.usage_notifications.daily_delivery_thresholds_percent.join("%, ") + "% thresholds")}</span></div><div><strong>Delivery and reset behavior</strong><span>${escapeHtml(state.redesignCatalog.usage_notifications.behavior_at_hard_limit)}. Notify via ${escapeHtml(state.redesignCatalog.usage_notifications.channels.join(", "))}.</span></div></div></section>
      <section class="drawer-section"><h3>Margin validation inputs</h3><div class="principle-list">${state.redesignCatalog.pricing_safety.minimum_cost_inputs_required_before_launch.map((text) => `<div><span>${escapeHtml(text)}</span></div>`).join("")}</div></section>
      <section class="drawer-section"><h3>Pricing conflicts found</h3><div class="principle-list">${state.redesignCatalog.pricing_safety.unverified_price_flags.map((text) => `<div><span>${escapeHtml(text)}</span></div>`).join("")}</div></section>`;
  }
}

function renderAddonSection(planKey) {
  const addons = state.redesignCatalog?.add_ons ?? [];
  const available = addons.filter((addon) => addon.availability?.includes(planKey));
  const legacy = state.addonsCatalog?.addons?.items ?? [];
  const legacyPriceByKey = { event_credit_pack: "events_10m", ai_credit_pack: "ai_credits_100k", project_pack: "extra_project", member_seat: "extra_member" };
  const rows = available.map((addon) => {
    const old = legacy.find((entry) => entry.key === legacyPriceByKey[addon.key]);
    const oldPrice = old?.prices?.[0];
    const oldLabel = oldPrice ? `Legacy listed price: $${Number(oldPrice.amount_major).toLocaleString()} per ${Number(oldPrice.unit_quantity).toLocaleString()} ${oldPrice.unit_label}. Under margin review.` : "No current catalog price.";
    return `<div class="addon-row"><div><strong>${escapeHtml(addon.name)}</strong><small>${escapeHtml(addon.pricing.replaceAll("_", " "))} · ${escapeHtml(addon.renewal ?? "")} ${oldLabel}</small></div><span>${escapeHtml(Number(addon.recommended_unit_quantity).toLocaleString())} ${escapeHtml(addon.unit)}</span></div>`;
  }).join("") || `<p class="muted-copy">No paid add-ons on Free. Usage stops at the included hard limits.</p>`;
  return `<section class="drawer-section"><h3>Proposed capacity add-ons <span class="section-note">Explicit opt-in</span></h3>${rows}</section>`;
}

function renderEntitlementDetails(plan) {
  const featureRows = Object.entries(plan.feature_entitlements ?? {}).map(([key, value]) => entitlementRow(key, value)).join("");
  const integrationRows = Object.entries(plan.integration_entitlements ?? {}).map(([key, value]) => entitlementRow(key, value)).join("");
  const featureCount = Object.keys(plan.feature_entitlements ?? {}).length;
  const integrationCount = Object.keys(plan.integration_entitlements ?? {}).length;
  return `<section class="drawer-section entitlement-section"><h3>Feature and integration entitlements</h3><details><summary>Feature gates · ${featureCount}</summary><div class="entitlement-list">${featureRows}</div></details><details><summary>Integration access · ${integrationCount}</summary><div class="entitlement-list">${integrationRows}</div></details></section>`;
}

function entitlementRow(key, value) {
  const stateText = value === true ? "On" : value === false ? "Off" : value === null ? "Not set" : String(value);
  const className = value === true ? "enabled" : value === false ? "disabled" : "custom";
  return `<div class="entitlement-row"><span>${escapeHtml(titleize(key))}<small>${escapeHtml(key)}</small></span><strong class="${className}">${escapeHtml(stateText)}</strong></div>`;
}

const quotaLabels = {
  "quota.monthly_events": "Monthly event credits",
  "quota.ai_credits": "Monthly AI credits",
  "quota.retained_gb": "Retained data ceiling",
  "quota.daily_alerts": "Daily alert notifications",
  "quota.daily_integration_deliveries": "Daily integration deliveries",
  "quota.project_alert_rules": "Alert rules per project",
  "quota.alert_channels": "Organization notification channels",
  "quota.project_notification_channels": "Notification channels per project",
  "quota.requests_per_second": "Ingestion rate limit",
};

function quotaLabel(key) {
  return quotaLabels[key] ?? titleize(key.replace(/^quota\./, ""));
}

function displayLimit(value, key = "") {
  if (value === undefined || value === null || value === "") return "n/a";
  if (typeof value === "number") {
    const units = {
      "quota.requests_per_second": " req/s",
      "quota.retention_days": " days",
      "quota.audit_log_retention_days": " days",
      "quota.retained_gb": " GB",
      "quota.monthly_events": " credits",
      "quota.ai_credits": " credits",
    };
    return `${value.toLocaleString()}${units[key] ?? ""}`;
  }
  return String(value);
}

document.querySelector("#closeDrawer").addEventListener("click", () => el.drawer.close());
el.copyProposal.addEventListener("click", async () => {
  const plan = state.redesignCatalog?.plans?.find((item) => item.key === state.drawerPlanKey);
  if (!plan) return;
  await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
  el.copyProposal.textContent = "Copied";
  setTimeout(() => { el.copyProposal.textContent = "Copy plan JSON"; }, 1200);
});
el.drawer.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-drawer]")) el.drawer.close();
});
document.querySelectorAll("[data-drawer-tab]").forEach((button) => button.addEventListener("click", () => {
  state.drawerTab = button.dataset.drawerTab;
  renderDrawer();
}));

el.search.addEventListener("input", () => {
  state.query = el.search.value.trim();
  render();
});

el.source.addEventListener("change", async () => {
  state.source = el.source.value;
  await loadSource(state.source);
});

el.copy.addEventListener("click", async () => {
  await navigator.clipboard.writeText(el.json.textContent);
  el.copy.textContent = "Copied";
  setTimeout(() => {
    el.copy.textContent = "Copy";
  }, 1200);
});

loadSource(state.source).catch((error) => {
  el.meta.textContent = error.message;
  el.detail.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
