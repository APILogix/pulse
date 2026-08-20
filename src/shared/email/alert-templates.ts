/**
 * Alert & monitoring email templates — Sentinel Mono.
 *
 * These are the on-call surface of the product. They obey a different set of
 * rules from the transactional templates in `./templates.ts`, because the
 * reader is triaging at 03:00, not browsing:
 *
 *   1. **No greeting.** An alert is machine-to-human. It leads with the fact,
 *      not with "Hi,". Every word before the verdict is a word in the way.
 *   2. **Subject is the alert.** `[FIRING · CRITICAL] rule — project (env)`
 *      follows the convention on-call engineers already have inbox rules and
 *      pager integrations for. State first, severity second, identity third.
 *   3. **Severity is pre-verbal.** The 3px top rail and the eyebrow dot carry
 *      the verdict in the truth channel, so severity registers before a single
 *      word is parsed — and survives in a plaintext-only client via the
 *      subject prefix.
 *   4. **Numbers before prose.** Observed value against threshold, in mono at
 *      30px, above any sentence explaining it.
 *   5. **Two paths, always.** "View alert" plus a mitigation
 *      ("Acknowledge", "Silence") — the reader is deciding, not reading.
 *   6. **Cyan means a model said it.** AI insight cards are the only cyan in
 *      the email (§2.4). If cyan appears, inference produced that sentence, and
 *      it arrives with a confidence score attached.
 *   7. **Every alert is identifiable.** Fingerprint and event id ship in the
 *      body so an email can be correlated with the audit log and the dedupe
 *      chain without opening the app.
 */

import {
  aiInsight,
  block,
  button,
  buttonRow,
  callout,
  codeBlock,
  dataTable,
  digestList,
  divider,
  esc,
  glyph,
  heading,
  metricCompare,
  p,
  pill,
  renderLayout,
  routeBadge,
  safeUrl,
  safeUrlText,
  sectionHeader,
  stack,
  statStrip,
  stripControl,
  textBody,
  textRows,
  type DataRow,
  type DigestItem,
} from './components.js';
import { font, palette, severityGlyph, severityTone, type AlertSeverity, type Tone } from './theme.js';
import type { EmailTemplate } from './templates.js';

export type { AlertSeverity };

/* ════════════════════════════════════════════════════════════════════════
   SHARED INPUT SHAPES
   ════════════════════════════════════════════════════════════════════════ */

/** Tenant/scope context shared by every alert email. */
export interface AlertScope {
  appName: string;
  orgName?: string | undefined;
  projectName?: string | undefined;
  /** Environment slug — production, staging, … */
  environment?: string | undefined;
  /** Deep link to the alert event in the app. */
  alertUrl?: string | undefined;
  /** Acknowledge action link. */
  acknowledgeUrl?: string | undefined;
  /** Silence action link. */
  silenceUrl?: string | undefined;
  /** Notification preferences, rendered as the footer link. */
  preferencesUrl?: string | undefined;
}

/** Identity of the firing rule and its event. */
export interface AlertIdentity {
  /** Rule name as configured, e.g. "API p95 latency". */
  ruleName: string;
  severity: AlertSeverity;
  /** Where the signal came from, e.g. "telemetry", "synthetic", "logs". */
  source?: string | undefined;
  /** Dedupe fingerprint — the key that groups repeats of this same alert. */
  fingerprint?: string | undefined;
  /** Alert event id, for correlation with the audit log. */
  eventId?: string | undefined;
  /** Pre-formatted timestamp — formatting/timezone is the caller's job. */
  startedAt?: string | undefined;
  /** How many times this fingerprint has fired in the current window. */
  occurrences?: number | undefined;
  /** Route / endpoint, e.g. "/api/v1/checkout". */
  endpoint?: string | undefined;
  /** HTTP method, e.g. "POST". */
  method?: string | undefined;
  /** HTTP status code, e.g. 500. */
  statusCode?: string | number | undefined;
  /** Latency / time taken, e.g. "1,450 ms". */
  duration?: string | undefined;
  /** Service name, e.g. "api". */
  service?: string | undefined;
  /** Distributed trace ID for root cause analysis. */
  traceId?: string | undefined;
  /** Distributed span ID. */
  spanId?: string | undefined;
  /** Client IP address. */
  clientIp?: string | undefined;
  /** Optional extra data table rows. */
  extraRows?: DataRow[] | undefined;
}

/** Observed value against the threshold that was crossed. */
export interface AlertMeasurement {
  /** What is being measured, e.g. "p95 latency", "Error rate". */
  label: string;
  /** Observed value, pre-formatted with units, e.g. "1,842 ms". */
  value: string;
  /** Threshold, pre-formatted with units, e.g. "800 ms". */
  threshold: string;
  /** Comparison window, e.g. "last 5 minutes". */
  window?: string | undefined;
}

/** Optional model output attached to an alert. */
export interface AlertInsight {
  text: string;
  /** 0–100. Omit when the model does not produce a score. */
  confidence?: number | undefined;
}

/* ════════════════════════════════════════════════════════════════════════
   SHARED COMPOSITION
   ════════════════════════════════════════════════════════════════════════ */

/** `checkout-api (production)` — the scope line used in subjects. */
function scopeLabel(scope: AlertScope): string {
  const project = stripControl(scope.projectName).trim();
  const env = stripControl(scope.environment).trim();
  if (project && env) return `${project} (${env})`;
  if (project) return project;
  if (env) return env;
  return stripControl(scope.orgName).trim();
}

/**
 * ` on checkout-api (production)`, or empty when the caller supplied no scope.
 *
 * Guards the preheader against rendering "… is firing on ." for an org-level
 * alert that has no project or environment attached.
 */
function scopeSuffix(scope: AlertScope): string {
  const where = scopeLabel(scope);
  return where ? ` on ${where}` : '';
}

/**
 * On-call subject line: `[STATE · SEVERITY] rule — scope`.
 *
 * Bracketed state first so inbox rules, pager bridges and mobile notification
 * previews can classify the message from its first eight characters.
 */
function alertSubject(state: string, severity: AlertSeverity | null, ruleName: string, scope: AlertScope): string {
  const tag = severity ? `[${state.toUpperCase()} · ${severity.toUpperCase()}]` : `[${state.toUpperCase()}]`;
  const where = scopeLabel(scope);
  const rule = stripControl(ruleName).trim() || 'Alert';
  return where ? `${tag} ${rule} — ${where}` : `${tag} ${rule}`;
}

/** Rows describing the alert itself. Empty fields are dropped, never shown blank. */
function identityRows(identity: AlertIdentity, scope: AlertScope): DataRow[] {
  const rows: DataRow[] = [
    { label: 'Rule', value: identity.ruleName, sans: true },
    { label: 'Severity', value: identity.severity.toUpperCase(), tone: severityTone(identity.severity) },
  ];
  if (identity.endpoint) rows.push({ label: 'Route', value: identity.endpoint, sans: true });
  if (identity.method) rows.push({ label: 'Method', value: String(identity.method).toUpperCase() });
  if (identity.statusCode !== undefined && identity.statusCode !== null && String(identity.statusCode).trim() !== '') {
    rows.push({ label: 'Status code', value: String(identity.statusCode) });
  }
  if (identity.duration) rows.push({ label: 'Time taken', value: identity.duration });
  if (identity.service) rows.push({ label: 'Service', value: identity.service, sans: true });
  if (scope.projectName) rows.push({ label: 'Project', value: scope.projectName, sans: true });
  if (scope.environment) rows.push({ label: 'Environment', value: scope.environment });
  if (identity.source) rows.push({ label: 'Source', value: identity.source });
  if (identity.startedAt) rows.push({ label: 'Started', value: identity.startedAt });
  if (typeof identity.occurrences === 'number') {
    rows.push({
      label: 'Occurrences',
      value: `${identity.occurrences} in this window`,
    });
  }
  if (identity.traceId) rows.push({ label: 'Trace ID', value: identity.traceId });
  if (identity.spanId) rows.push({ label: 'Span ID', value: identity.spanId });
  if (identity.clientIp) rows.push({ label: 'Client IP', value: identity.clientIp });
  if (identity.fingerprint) rows.push({ label: 'Fingerprint', value: identity.fingerprint });
  if (identity.eventId) rows.push({ label: 'Event id', value: identity.eventId });
  if (identity.extraRows && identity.extraRows.length > 0) {
    rows.push(...identity.extraRows);
  }
  return rows;
}

function plainRows(rows: DataRow[]): string {
  return textRows(rows.map((r) => ({ label: r.label, value: r.value })));
}

/**
 * Measurement surface.
 *
 * The window caption is folded into the metric label so it sits directly above
 * the pair of numbers it qualifies — a threshold without its window is not a
 * fact, it is a decoration.
 */
function measurementBlock(m: AlertMeasurement, tone: Tone): string {
  return metricCompare({
    label: m.window ? `${m.label} · ${m.window}` : m.label,
    value: m.value,
    threshold: m.threshold,
    tone,
  });
}

/** Footer link wiring — notification preferences when the caller supplies it. */
function footerLinkFor(scope: AlertScope): { url: string; label: string } | undefined {
  return scope.preferencesUrl
    ? { url: scope.preferencesUrl, label: 'Manage alert notifications' }
    : undefined;
}

/**
 * Primary + secondary CTAs for an alert.
 *
 * Falls back gracefully: with both links it renders a pair, with one it renders
 * a single button, with none it renders nothing rather than a dead control.
 */
function alertActions(
  scope: AlertScope,
  primaryLabel: string,
  secondary: { url: string | undefined; label: string },
  tone?: Tone | undefined,
): string {
  if (scope.alertUrl && secondary.url) {
    const primary: { url: string; label: string; tone?: Tone | undefined } = {
      url: scope.alertUrl,
      label: primaryLabel,
    };
    if (tone) primary.tone = tone;
    return buttonRow(primary, { url: secondary.url, label: secondary.label });
  }
  if (scope.alertUrl) return button(scope.alertUrl, primaryLabel, tone ? { tone } : {});
  if (secondary.url) return button(secondary.url, secondary.label, tone ? { tone } : {});
  return '';
}

function actionsText(scope: AlertScope, extra?: { label: string; url: string | undefined }): string {
  const lines: string[] = [];
  if (scope.alertUrl) lines.push(`View alert:   ${safeUrlText(scope.alertUrl)}`);
  if (extra?.url) lines.push(`${extra.label}: ${safeUrlText(extra.url)}`);
  return lines.join('\n');
}

/**
 * Modern developer-focused action CTAs with visual hierarchy:
 * Primary dominant button + Secondary ghost button + inline secondary links.
 */
function developerAlertActions(opts: {
  primary?: { url: string; label: string; tone?: Tone } | undefined;
  secondary?: { url: string; label: string } | undefined;
  viewAlertUrl?: string | undefined;
  acknowledgeUrl?: string | undefined;
  silenceUrl?: string | undefined;
}): { html: string; text: string } {
  const buttonsHtml: string[] = [];
  if (opts.primary && opts.secondary) {
    buttonsHtml.push(buttonRow(opts.primary, opts.secondary));
  } else if (opts.primary) {
    buttonsHtml.push(button(opts.primary.url, opts.primary.label, { tone: opts.primary.tone ?? 'brand', variant: 'primary' }));
  } else if (opts.viewAlertUrl) {
    buttonsHtml.push(button(opts.viewAlertUrl, 'View Alert', { tone: 'brand', variant: 'primary' }));
  }

  const links: string[] = [];
  if (opts.viewAlertUrl && (!opts.primary || opts.primary.url !== opts.viewAlertUrl) && (!opts.secondary || opts.secondary.url !== opts.viewAlertUrl)) {
    links.push(`<a href="${safeUrl(opts.viewAlertUrl)}" style="color:${palette.text2};text-decoration:underline;">View Alert</a>`);
  }
  if (opts.acknowledgeUrl && (!opts.secondary || opts.secondary.url !== opts.acknowledgeUrl)) {
    links.push(`<a href="${safeUrl(opts.acknowledgeUrl)}" style="color:${palette.text2};text-decoration:underline;">Acknowledge</a>`);
  }
  if (opts.silenceUrl) {
    links.push(`<a href="${safeUrl(opts.silenceUrl)}" style="color:${palette.text2};text-decoration:underline;">Silence</a>`);
  }

  const linksHtml = links.length > 0
    ? `<div style="margin-top:12px;font-family:${font.mono};font-size:12px;color:${palette.text3};">${links.join(' &nbsp;·&nbsp; ')}</div>`
    : '';

  const html = buttonsHtml.length > 0 || linksHtml
    ? `<div style="margin-top:8px;">${buttonsHtml.join('\n')}${linksHtml}</div>`
    : '';

  const textLines: string[] = [];
  if (opts.primary) textLines.push(`${opts.primary.label}: ${safeUrlText(opts.primary.url)}`);
  if (opts.secondary) textLines.push(`${opts.secondary.label}: ${safeUrlText(opts.secondary.url)}`);
  if (opts.viewAlertUrl && (!opts.primary || opts.primary.url !== opts.viewAlertUrl) && (!opts.secondary || opts.secondary.url !== opts.viewAlertUrl)) {
    textLines.push(`View Alert: ${safeUrlText(opts.viewAlertUrl)}`);
  }
  if (opts.acknowledgeUrl && (!opts.secondary || opts.secondary.url !== opts.acknowledgeUrl)) {
    textLines.push(`Acknowledge: ${safeUrlText(opts.acknowledgeUrl)}`);
  }
  if (opts.silenceUrl) textLines.push(`Silence: ${safeUrlText(opts.silenceUrl)}`);

  return { html, text: textLines.join('\n') };
}

/* ════════════════════════════════════════════════════════════════════════
   1. ALERT FIRING
   ════════════════════════════════════════════════════════════════════════ */

export interface AlertFiringInput extends AlertScope {
  identity: AlertIdentity;
  /** Optional measurement that tripped the rule. */
  measurement?: AlertMeasurement | undefined;
  /** One-line human summary of what is wrong. */
  summary?: string | undefined;
  /** Suggested first action, rendered as a neutral callout. */
  runbook?: string | undefined;
  /** Model output — the only cyan in the email. */
  insight?: AlertInsight | undefined;
  traceUrl?: string | undefined;
  requestUrl?: string | undefined;
}

/**
 * The core alert notification: a rule crossed its threshold and is firing.
 * Enhanced with developer triage sections: Metric Compare, Route context, Trace correlation, and Actions.
 */
export function alertFiringTemplate(input: AlertFiringInput): EmailTemplate {
  const severity = input.identity.severity;
  const tone = severityTone(severity);
  const id = input.identity;

  // 1. REQUEST & ROUTE
  const reqRows: DataRow[] = [];
  if (id.endpoint) {
    const routeVal = id.method ? `${String(id.method).toUpperCase()} ${id.endpoint}` : id.endpoint;
    reqRows.push({ label: 'Route', value: routeVal, sans: true });
  }
  if (id.method && !id.endpoint) {
    reqRows.push({ label: 'Method', value: String(id.method).toUpperCase() });
  }
  if (id.statusCode !== undefined && id.statusCode !== null && String(id.statusCode).trim() !== '') {
    reqRows.push({ label: 'HTTP status', value: String(id.statusCode) });
  }
  if (id.duration) {
    reqRows.push({ label: 'Time taken', value: id.duration });
  }
  if (id.service) {
    reqRows.push({ label: 'Service', value: id.service, sans: true });
  }

  // 2. TRACE & CORRELATION
  const traceRows: DataRow[] = [];
  if (id.traceId) {
    traceRows.push({ label: 'Trace ID', value: id.traceId });
  }
  if (id.spanId) {
    traceRows.push({ label: 'Span ID', value: id.spanId });
  }
  if (id.clientIp) {
    traceRows.push({ label: 'Client IP', value: id.clientIp });
  }
  if (id.fingerprint) {
    traceRows.push({ label: 'Fingerprint', value: id.fingerprint });
  }
  if (id.eventId) {
    traceRows.push({ label: 'Event ID', value: id.eventId });
  }
  if (id.extraRows && id.extraRows.length > 0) {
    traceRows.push(...id.extraRows);
  }

  // 3. CONTEXT & METADATA
  const metaRows: DataRow[] = [
    { label: 'Severity', value: severity.toUpperCase(), tone },
  ];
  if (input.projectName) metaRows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) metaRows.push({ label: 'Environment', value: input.environment });
  if (id.source) metaRows.push({ label: 'Source', value: id.source });
  if (id.startedAt) metaRows.push({ label: 'Started', value: id.startedAt });
  if (typeof id.occurrences === 'number') {
    metaRows.push({ label: 'Occurrences', value: `${id.occurrences} in this window` });
  }

  // 4. ACTIONS
  const primaryAction = input.traceUrl
    ? { url: input.traceUrl, label: 'Analyze Trace', tone }
    : input.requestUrl
      ? { url: input.requestUrl, label: 'View Request', tone }
      : input.alertUrl
        ? { url: input.alertUrl, label: 'View Alert', tone }
        : undefined;

  const secondaryAction = input.traceUrl && input.alertUrl
    ? { url: input.alertUrl, label: 'View Alert' }
    : input.acknowledgeUrl
      ? { url: input.acknowledgeUrl, label: 'Acknowledge' }
      : undefined;

  const actions = developerAlertActions({
    primary: primaryAction,
    secondary: secondaryAction,
    viewAlertUrl: input.alertUrl,
    acknowledgeUrl: input.acknowledgeUrl,
    silenceUrl: input.silenceUrl,
  });

  const bodyBlocks: (string | null | undefined | false)[] = [];

  if (input.summary) {
    bodyBlocks.push(p(esc(input.summary)));
  }

  if (input.measurement) {
    bodyBlocks.push(measurementBlock(input.measurement, tone));
  }

  if (reqRows.length > 0) {
    bodyBlocks.push(sectionHeader('TARGET & ROUTE'), dataTable(reqRows));
  }

  if (traceRows.length > 0) {
    bodyBlocks.push(sectionHeader('DISTRIBUTED TRACE & CORRELATION'), dataTable(traceRows));
  }

  if (metaRows.length > 0) {
    bodyBlocks.push(sectionHeader('INCIDENT SCOPE'), dataTable(metaRows));
  }

  if (input.insight) {
    bodyBlocks.push(sectionHeader('AI DIAGNOSIS'), aiInsight(input.insight));
  }

  if (input.runbook) {
    bodyBlocks.push(callout('neutral', esc(input.runbook), 'First response / Runbook'));
  }

  if (actions.html) {
    bodyBlocks.push(sectionHeader('TRIAGE & ACTIONS'), actions.html);
  }

  const textSections: (string | null | undefined | false)[] = [
    `ALERT FIRING — ${severity.toUpperCase()}`,
    input.summary,
    input.measurement
      ? `${input.measurement.label}: ${input.measurement.value} (threshold ${input.measurement.threshold}${input.measurement.window ? `, ${input.measurement.window}` : ''})`
      : '',
  ];
  if (reqRows.length > 0) {
    textSections.push(`\n--- TARGET & ROUTE ---`, plainRows(reqRows));
  }
  if (traceRows.length > 0) {
    textSections.push(`\n--- TRACE & CORRELATION ---`, plainRows(traceRows));
  }
  if (metaRows.length > 0) {
    textSections.push(`\n--- INCIDENT SCOPE ---`, plainRows(metaRows));
  }
  if (input.insight) {
    textSections.push(`\n--- AI DIAGNOSIS ---`, `AI Insight: ${input.insight.text}${input.insight.confidence ? ` (${Math.round(input.insight.confidence)}% confidence)` : ''}`);
  }
  if (input.runbook) {
    textSections.push(`\nFirst response: ${input.runbook}`);
  }
  if (actions.text) {
    textSections.push(`\n--- ACTIONS ---`, actions.text);
  }

  return {
    subject: alertSubject('firing', severity, id.ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: id.ruleName,
      eyebrowText: `Firing · ${severity}`,
      preheader: input.measurement
        ? `${stripControl(input.measurement.label)} ${stripControl(input.measurement.value)} exceeded ${stripControl(input.measurement.threshold)}${scopeSuffix(input)}.`
        : `${stripControl(id.ruleName)} is firing${scopeSuffix(input)}.`,
      tone,
      chip: severityGlyph(severity),
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(...textSections),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   2. ALERT RESOLVED
   ════════════════════════════════════════════════════════════════════════ */

export interface AlertResolvedInput extends AlertScope {
  identity: AlertIdentity;
  /** How long the alert was firing, pre-formatted, e.g. "14 minutes". */
  duration?: string | undefined;
  /** Who or what resolved it — a user name, or "auto-resolve". */
  resolvedBy?: string | undefined;
  /** Pre-formatted resolution timestamp. */
  resolvedAt?: string | undefined;
  /** Resolution reason recorded on the event. */
  reason?: string | undefined;
  /** Value the metric recovered to, e.g. "412 ms". */
  recoveredValue?: string | undefined;
  insight?: AlertInsight | undefined;
}

/**
 * Recovery notice. Always sent when a firing alert clears.
 * Green here is the truth channel doing its job: a verdict, not decoration.
 */
export function alertResolvedTemplate(input: AlertResolvedInput): EmailTemplate {
  const id = input.identity;

  // 1. RESOLUTION DETAILS
  const resRows: DataRow[] = [
    { label: 'Rule', value: id.ruleName, sans: true },
    { label: 'Status', value: 'RESOLVED', tone: 'success' },
  ];
  if (input.recoveredValue) resRows.push({ label: 'Recovered to', value: input.recoveredValue, tone: 'success' });
  if (input.duration) resRows.push({ label: 'Duration active', value: input.duration, tone: 'success' });
  if (input.resolvedBy) resRows.push({ label: 'Resolved by', value: input.resolvedBy, sans: true });
  if (input.resolvedAt) resRows.push({ label: 'Resolved at', value: input.resolvedAt });
  if (id.startedAt) resRows.push({ label: 'Started at', value: id.startedAt });
  if (input.reason) resRows.push({ label: 'Reason', value: input.reason, sans: true });

  // 2. INCIDENT CONTEXT
  const ctxRows: DataRow[] = [];
  if (id.endpoint) {
    const routeVal = id.method ? `${String(id.method).toUpperCase()} ${id.endpoint}` : id.endpoint;
    ctxRows.push({ label: 'Route', value: routeVal, sans: true });
  }
  if (id.service) ctxRows.push({ label: 'Service', value: id.service, sans: true });
  if (input.projectName) ctxRows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) ctxRows.push({ label: 'Environment', value: input.environment });
  if (id.traceId) ctxRows.push({ label: 'Trace ID', value: id.traceId });
  if (id.fingerprint) ctxRows.push({ label: 'Fingerprint', value: id.fingerprint });

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(
      `${esc(id.ruleName)} has cleared${input.duration ? ` after ${esc(input.duration)}` : ''}. All monitored metrics returned to normal thresholds.`,
    ),
    pill('Resolved', 'success'),
    sectionHeader('RESOLUTION DETAILS'),
    dataTable(resRows),
  ];

  if (ctxRows.length > 0) {
    bodyBlocks.push(sectionHeader('INCIDENT SCOPE'), dataTable(ctxRows));
  }
  if (input.insight) {
    bodyBlocks.push(sectionHeader('AI DIAGNOSIS'), aiInsight(input.insight));
  }
  if (input.alertUrl) {
    bodyBlocks.push(sectionHeader('TIMELINE'), button(input.alertUrl, 'View Incident Timeline'));
  }

  const textSections: (string | null | undefined | false)[] = [
    'ALERT RESOLVED',
    `${id.ruleName} has cleared${input.duration ? ` after ${input.duration}` : ''}.`,
    `\n--- RESOLUTION DETAILS ---`,
    plainRows(resRows),
  ];
  if (ctxRows.length > 0) {
    textSections.push(`\n--- INCIDENT SCOPE ---`, plainRows(ctxRows));
  }
  if (input.alertUrl) {
    textSections.push(`\nView timeline: ${safeUrlText(input.alertUrl)}`);
  }

  return {
    subject: alertSubject('resolved', null, id.ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: `Resolved: ${id.ruleName}`,
      eyebrowText: 'Resolved',
      preheader: `${stripControl(id.ruleName)} cleared${input.duration ? ` after ${stripControl(input.duration)}` : ''}${scopeSuffix(input)}.`,
      tone: 'success',
      chip: glyph.check,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(...textSections),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   3. ALERT ACKNOWLEDGED
   ════════════════════════════════════════════════════════════════════════ */

export interface AlertAcknowledgedInput extends AlertScope {
  identity: AlertIdentity;
  /** Who took it. */
  acknowledgedBy: string;
  acknowledgedAt?: string | undefined;
  /** Note left by the responder. */
  comment?: string | undefined;
  /** When the acknowledgement lapses and escalation resumes. */
  expiresAt?: string | undefined;
}

/**
 * Acknowledgement notice — tells the rest of the rotation the alert is owned.
 */
export function alertAcknowledgedTemplate(input: AlertAcknowledgedInput): EmailTemplate {
  const id = input.identity;

  const ackRows: DataRow[] = [
    { label: 'Rule', value: id.ruleName, sans: true },
    { label: 'Owner', value: input.acknowledgedBy, sans: true, tone: 'info' },
  ];
  if (input.acknowledgedAt) ackRows.push({ label: 'Acknowledged at', value: input.acknowledgedAt });
  if (input.expiresAt) ackRows.push({ label: 'Ack expires', value: input.expiresAt, tone: 'warning' });
  if (input.projectName) ackRows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) ackRows.push({ label: 'Environment', value: input.environment });
  if (id.fingerprint) ackRows.push({ label: 'Fingerprint', value: id.fingerprint });

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(`${esc(input.acknowledgedBy)} has taken ownership of this alert. Escalation is paused.`),
    pill('Acknowledged', 'info'),
    sectionHeader('OWNERSHIP & STATUS'),
    dataTable(ackRows),
  ];

  if (input.comment) {
    bodyBlocks.push(callout('neutral', esc(input.comment), 'Responder note'));
  }
  if (input.expiresAt) {
    bodyBlocks.push(
      callout(
        'warning',
        `Escalation is paused until ${esc(input.expiresAt)}. If the alert is still firing then, the escalation policy resumes automatically.`,
        'Escalation paused',
      ),
    );
  }
  if (input.alertUrl) {
    bodyBlocks.push(sectionHeader('ACTIONS'), button(input.alertUrl, 'View Alert'));
  }

  return {
    subject: alertSubject('acknowledged', null, id.ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: `Acknowledged: ${id.ruleName}`,
      eyebrowText: 'Acknowledged',
      preheader: `${stripControl(input.acknowledgedBy)} is on it — escalation is paused.`,
      tone: 'info',
      chip: glyph.dot,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      'ALERT ACKNOWLEDGED',
      `${input.acknowledgedBy} has taken ownership of ${id.ruleName}.`,
      plainRows(ackRows),
      input.comment ? `Responder note: ${input.comment}` : '',
      input.alertUrl ? `View alert: ${safeUrlText(input.alertUrl)}` : '',
    ),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   4. ALERT ESCALATED
   ════════════════════════════════════════════════════════════════════════ */

export interface AlertEscalatedInput extends AlertScope {
  identity: AlertIdentity;
  /** Escalation policy name. */
  policyName: string;
  /** Which step just fired (1-based). */
  stepNumber: number;
  totalSteps?: number | undefined;
  /** Why it escalated, e.g. "no acknowledgement within 15 minutes". */
  trigger?: string | undefined;
  /** Who this step notifies. */
  notifying?: string | undefined;
  /** How long it has been firing. */
  firingFor?: string | undefined;
}

/**
 * Escalation notice — an alert went unanswered and the policy advanced.
 */
export function alertEscalatedTemplate(input: AlertEscalatedInput): EmailTemplate {
  const id = input.identity;
  const step = input.totalSteps
    ? `Step ${input.stepNumber} of ${input.totalSteps}`
    : `Step ${input.stepNumber}`;

  // 1. ESCALATION STATUS
  const escRows: DataRow[] = [
    { label: 'Rule', value: id.ruleName, sans: true },
    { label: 'Severity', value: id.severity.toUpperCase(), tone: severityTone(id.severity) },
    { label: 'Escalation policy', value: input.policyName, sans: true },
    { label: 'Current step', value: step, tone: 'danger' },
  ];
  if (input.firingFor) escRows.push({ label: 'Firing for', value: input.firingFor, tone: 'danger' });
  if (input.trigger) escRows.push({ label: 'Trigger', value: input.trigger, sans: true });
  if (input.notifying) escRows.push({ label: 'Notifying', value: input.notifying, sans: true });

  // 2. TARGET & TELEMETRY
  const targetRows: DataRow[] = [];
  if (id.endpoint) {
    const routeVal = id.method ? `${String(id.method).toUpperCase()} ${id.endpoint}` : id.endpoint;
    targetRows.push({ label: 'Route', value: routeVal, sans: true });
  }
  if (id.statusCode !== undefined && id.statusCode !== null) {
    targetRows.push({ label: 'Status code', value: String(id.statusCode) });
  }
  if (id.duration) targetRows.push({ label: 'Time taken', value: id.duration });
  if (id.service) targetRows.push({ label: 'Service', value: id.service, sans: true });
  if (input.projectName) targetRows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) targetRows.push({ label: 'Environment', value: input.environment });
  if (id.traceId) targetRows.push({ label: 'Trace ID', value: id.traceId });
  if (id.fingerprint) targetRows.push({ label: 'Fingerprint', value: id.fingerprint });

  // 3. ACTIONS
  const actions = developerAlertActions({
    primary: input.acknowledgeUrl ? { url: input.acknowledgeUrl, label: 'Take Ownership', tone: 'danger' } : undefined,
    secondary: input.alertUrl ? { url: input.alertUrl, label: 'View Alert' } : undefined,
    viewAlertUrl: input.alertUrl,
    acknowledgeUrl: input.acknowledgeUrl,
    silenceUrl: input.silenceUrl,
  });

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(
      `This alert has not been acknowledged, so <strong>${esc(input.policyName)}</strong> advanced to <strong>${esc(step.toLowerCase())}</strong> and widened the notification.`,
    ),
    pill(step, 'danger'),
    sectionHeader('ESCALATION STATUS'),
    dataTable(escRows),
  ];

  if (targetRows.length > 0) {
    bodyBlocks.push(sectionHeader('TELEMETRY & TARGET'), dataTable(targetRows));
  }

  if (actions.html) {
    bodyBlocks.push(sectionHeader('TRIAGE & ACTIONS'), actions.html);
  }

  bodyBlocks.push(
    callout(
      'danger',
      'Acknowledging stops further escalation. Silencing suppresses notifications without resolving the underlying condition — prefer acknowledgement while you investigate.',
      'How to stop escalation',
    ),
  );

  return {
    subject: alertSubject(`escalated s${input.stepNumber}`, id.severity, id.ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: `Escalated: ${id.ruleName}`,
      eyebrowText: `Escalated · ${step.toLowerCase()}`,
      preheader: `Unacknowledged${input.firingFor ? ` for ${stripControl(input.firingFor)}` : ''} — ${stripControl(input.policyName)} escalated to ${step.toLowerCase()}.`,
      tone: 'danger',
      chip: glyph.arrowUp,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `ALERT ESCALATED — ${step.toUpperCase()}`,
      `${id.ruleName} was not acknowledged; ${input.policyName} advanced to ${step.toLowerCase()}.`,
      `\n--- ESCALATION STATUS ---`,
      plainRows(escRows),
      targetRows.length > 0 ? `\n--- TELEMETRY ---` : '',
      targetRows.length > 0 ? plainRows(targetRows) : '',
      actions.text ? `\n--- ACTIONS ---` : '',
      actions.text,
      'Acknowledging stops further escalation.',
    ),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   5. ALERT SILENCED
   ════════════════════════════════════════════════════════════════════════ */

export interface AlertSilencedInput extends AlertScope {
  /** What the silence matches — rule name, or a label matcher expression. */
  target: string;
  silencedBy: string;
  /** Pre-formatted expiry, or "never" for an open-ended silence. */
  expiresAt: string;
  /** Duration, pre-formatted. */
  duration?: string | undefined;
  reason?: string | undefined;
  /** How many rules the matcher covers. */
  matchedRules?: number | undefined;
}

/**
 * Silence-created notice.
 */
export function alertSilencedTemplate(input: AlertSilencedInput): EmailTemplate {
  const silenceRows: DataRow[] = [
    { label: 'Target', value: input.target, sans: true },
    { label: 'Silenced by', value: input.silencedBy, sans: true },
    { label: 'Expires at', value: input.expiresAt, tone: 'warning' },
  ];
  if (input.duration) silenceRows.push({ label: 'Duration', value: input.duration });
  if (typeof input.matchedRules === 'number') {
    silenceRows.push({ label: 'Rules matched', value: String(input.matchedRules), tone: 'warning' });
  }
  if (input.projectName) silenceRows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) silenceRows.push({ label: 'Environment', value: input.environment });
  if (input.reason) silenceRows.push({ label: 'Reason', value: input.reason, sans: true });

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(
      `Notifications matching <strong>${esc(input.target)}</strong> are suppressed until ${esc(input.expiresAt)}. Rules keep evaluating and events keep recording &mdash; only the notifications stop.`,
    ),
    pill('Silenced', 'warning'),
    sectionHeader('SILENCE DETAILS'),
    dataTable(silenceRows),
    callout(
      'warning',
      'Anything this matcher covers will not page anyone while the silence is active. Remove it as soon as the maintenance or noisy deploy that justified it is over.',
      'Coverage gap warning',
    ),
  ];

  if (input.silenceUrl) {
    bodyBlocks.push(sectionHeader('ACTIONS'), button(input.silenceUrl, 'Manage Silence', { tone: 'warning' }));
  }

  return {
    subject: alertSubject('silenced', null, input.target, input),
    html: renderLayout({
      appName: input.appName,
      title: 'Alerts silenced',
      eyebrowText: 'Silenced',
      preheader: `${stripControl(input.target)} will not notify anyone until ${stripControl(input.expiresAt)}.`,
      tone: 'warning',
      chip: glyph.pause,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      'ALERTS SILENCED',
      `Notifications matching ${input.target} are suppressed until ${input.expiresAt}.`,
      plainRows(silenceRows),
      input.silenceUrl ? `Manage silence: ${safeUrlText(input.silenceUrl)}` : '',
      'Rules keep evaluating; only notifications stop.',
    ),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   6. ALERT DIGEST
   ════════════════════════════════════════════════════════════════════════ */

export interface DigestAlertEntry {
  ruleName: string;
  severity: AlertSeverity;
  /** Short context line, e.g. "checkout-api · 12 occurrences · 09:41". */
  meta: string;
}

export interface AlertDigestInput extends AlertScope {
  /** Period covered, e.g. "last 24 hours". */
  period: string;
  counts: {
    firing: number;
    resolved: number;
    acknowledged: number;
  };
  /** Alerts to list, already sorted by the caller (severity, then recency). */
  entries: DigestAlertEntry[];
  /** Total matching alerts when `entries` is truncated. */
  totalCount?: number | undefined;
  /** Link to the full alert feed. */
  feedUrl?: string | undefined;
  insight?: AlertInsight | undefined;
}

/**
 * Periodic roll-up.
 *
 * The antidote to per-event noise: batch low-severity alerts into one scannable
 * digest so the real-time channel stays trustworthy for things that actually
 * need waking someone up.
 */
export function alertDigestTemplate(input: AlertDigestInput): EmailTemplate {
  const items: DigestItem[] = input.entries.map((entry) => ({
    severityLabel: entry.severity,
    tone: severityTone(entry.severity),
    mark: severityGlyph(entry.severity),
    title: entry.ruleName,
    meta: entry.meta,
  }));

  const shown = input.entries.length;
  const total = input.totalCount ?? shown;
  const truncated = total > shown;

  const body = stack([
    p(
      `Alert activity across ${esc(scopeLabel(input) || stripControl(input.orgName) || 'your organization')} for the ${esc(input.period)}.`,
    ),
    statStrip([
      { label: 'Firing', value: String(input.counts.firing), tone: input.counts.firing > 0 ? 'danger' : 'neutral' },
      { label: 'Resolved', value: String(input.counts.resolved), tone: 'success' },
      { label: 'Acknowledged', value: String(input.counts.acknowledged), tone: 'info' },
    ]),
    shown > 0 ? heading(truncated ? `Top ${shown} of ${total} alerts` : `${shown} alert${shown === 1 ? '' : 's'}`) + digestList(items) : '',
    input.insight ? aiInsight(input.insight) : '',
    input.feedUrl ? button(input.feedUrl, 'Open alert feed') : '',
    input.counts.firing === 0 && shown === 0
      ? callout('success', 'Nothing fired in this period. All monitored rules stayed inside their thresholds.', 'All clear')
      : '',
  ]);

  return {
    subject: `[DIGEST] ${total} alert${total === 1 ? '' : 's'} · ${stripControl(input.period)}${scopeLabel(input) ? ` — ${scopeLabel(input)}` : ''}`,
    html: renderLayout({
      appName: input.appName,
      title: `Alert digest · ${input.period}`,
      eyebrowText: `Digest · ${input.period}`,
      preheader: `${input.counts.firing} firing, ${input.counts.resolved} resolved, ${input.counts.acknowledged} acknowledged in the ${stripControl(input.period)}.`,
      tone: input.counts.firing > 0 ? 'warning' : 'success',
      chip: glyph.square,
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `ALERT DIGEST — ${input.period.toUpperCase()}`,
      textRows([
        { label: 'Firing', value: String(input.counts.firing) },
        { label: 'Resolved', value: String(input.counts.resolved) },
        { label: 'Acknowledged', value: String(input.counts.acknowledged) },
      ]),
      input.entries
        .map((e) => `${e.severity.toUpperCase().padEnd(9)} ${e.ruleName} — ${e.meta}`)
        .join('\n'),
      truncated ? `Showing ${shown} of ${total} alerts.` : '',
      input.feedUrl ? `Open alert feed: ${safeUrlText(input.feedUrl)}` : '',
    ),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   7. ANOMALY DETECTED  (AI channel)
   ════════════════════════════════════════════════════════════════════════ */

export interface AnomalyDetectedInput extends AlertScope {
  /** What looks wrong, e.g. "Request latency deviating from baseline". */
  title: string;
  /** The model's explanation. */
  explanation: string;
  /** 0–100 confidence. */
  confidence?: number | undefined;
  /** Metric under observation. */
  metric?: string | undefined;
  /** Observed value, pre-formatted. */
  observed?: string | undefined;
  /** Learned baseline, pre-formatted. */
  baseline?: string | undefined;
  /** Deviation, pre-formatted, e.g. "+340%". */
  deviation?: string | undefined;
  /** Window the model looked at. */
  window?: string | undefined;
  detectedAt?: string | undefined;
  /** Model-suggested remediation. */
  suggestedAction?: string | undefined;
}

/**
 * AI anomaly notice.
 *
 * The one template where cyan is the dominant channel, because the entire
 * message is model output — there is no threshold, only inference. Baseline and
 * deviation are shown beside the observed value so the reader can judge the
 * claim instead of taking it on trust.
 */
export function anomalyDetectedTemplate(input: AnomalyDetectedInput): EmailTemplate {
  const statRows: DataRow[] = [];
  if (input.metric) statRows.push({ label: 'Metric', value: input.metric, sans: true });
  if (input.baseline) statRows.push({ label: 'Baseline', value: input.baseline });
  if (input.observed) statRows.push({ label: 'Observed', value: input.observed });
  if (input.deviation) statRows.push({ label: 'Deviation', value: input.deviation, tone: 'ai' });
  if (input.window) statRows.push({ label: 'Window', value: input.window });
  if (input.projectName) statRows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) statRows.push({ label: 'Environment', value: input.environment });
  if (input.detectedAt) statRows.push({ label: 'Detected', value: input.detectedAt });

  const insightInput: AlertInsight =
    typeof input.confidence === 'number'
      ? { text: input.explanation, confidence: input.confidence }
      : { text: input.explanation };

  const bodyBlocks: (string | null | undefined | false)[] = [];

  if (input.observed && input.baseline) {
    bodyBlocks.push(
      metricCompare({
        label: input.metric ? `${input.metric} observed` : 'Observed',
        value: input.observed,
        threshold: input.baseline,
        thresholdLabel: 'Baseline',
        tone: 'ai',
      }),
    );
  }

  bodyBlocks.push(sectionHeader('AI DIAGNOSIS'), aiInsight(insightInput));

  if (statRows.length > 0) {
    bodyBlocks.push(sectionHeader('STATISTICAL CONTEXT'), dataTable(statRows));
  }

  if (input.suggestedAction) {
    bodyBlocks.push(callout('ai', esc(input.suggestedAction), 'Suggested next step'));
  }

  if (input.alertUrl) {
    bodyBlocks.push(sectionHeader('ACTIONS'), button(input.alertUrl, 'Investigate Anomaly', { tone: 'ai' }));
  }

  bodyBlocks.push(
    callout(
      'neutral',
      'This is a statistical detection, not a threshold breach — no rule fired. Treat it as a lead to investigate rather than a confirmed fault.',
      'How to read this',
    ),
  );

  return {
    subject: `[ANOMALY] ${stripControl(input.title)}${scopeLabel(input) ? ` — ${scopeLabel(input)}` : ''}`,
    html: renderLayout({
      appName: input.appName,
      title: input.title,
      eyebrowText: 'AI · anomaly detected',
      preheader: input.deviation
        ? `${stripControl(input.metric ?? 'A metric')} is ${stripControl(input.deviation)} from its learned baseline.`
        : `A model flagged unusual behaviour${scopeSuffix(input)}.`,
      tone: 'ai',
      chip: glyph.spark,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      'ANOMALY DETECTED (AI)',
      input.title,
      input.explanation,
      typeof input.confidence === 'number' ? `Confidence: ${Math.round(input.confidence)}%` : '',
      statRows.length > 0 ? `\n--- STATISTICAL CONTEXT ---` : '',
      statRows.length > 0 ? plainRows(statRows) : '',
      input.suggestedAction ? `Suggested next step: ${input.suggestedAction}` : '',
      input.alertUrl ? `Investigate: ${safeUrlText(input.alertUrl)}` : '',
    ),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   8. LATENCY THRESHOLD
   ════════════════════════════════════════════════════════════════════════ */

export interface LatencyAlertInput extends AlertScope {
  /** Percentile being watched, e.g. "p95" or "P95". */
  percentile: string;
  /** Observed latency, pre-formatted with units, e.g. "1,450 ms" or "1.45s". */
  observed: string;
  /** Configured threshold, pre-formatted with units, e.g. "500 ms". */
  threshold: string;
  /** Difference above threshold, e.g. "+950 ms (+190%)". */
  aboveThreshold?: string | undefined;
  /** Evaluation window, e.g. "5 min". */
  window?: string | undefined;
  /** Route or service that is slow, e.g. "/api/v1/orders". */
  endpoint?: string | undefined;
  /** HTTP method, e.g. "POST". */
  method?: string | undefined;
  /** HTTP status code, e.g. 504. */
  statusCode?: string | number | undefined;
  /** Duration taken, e.g. "1,450 ms" or "1.45s". */
  duration?: string | undefined;
  /** Distributed trace ID. */
  traceId?: string | undefined;
  /** Public trace ID, e.g. "TRC-000000052". */
  tracePublicId?: string | undefined;
  /** Distributed span ID. */
  spanId?: string | undefined;
  /** Public span ID, e.g. "SPN-000001293". */
  spanPublicId?: string | undefined;
  /** Request ID, e.g. "REQ-000000123". */
  requestId?: string | undefined;
  /** Client IP address. */
  clientIp?: string | undefined;
  /** Service name, e.g. "checkout-api". */
  service?: string | undefined;
  /** Release, e.g. "1.0.0". */
  release?: string | undefined;
  /** Rule name as configured. */
  ruleName?: string | undefined;
  /** Sample size behind the percentile. */
  sampleSize?: number | undefined;
  /** Slowest contributing operations. */
  topContributors?: string[] | undefined;
  severity?: AlertSeverity | undefined;
  startedAt?: string | undefined;
  insight?: AlertInsight | undefined;
  extraRows?: DataRow[] | undefined;
  traceUrl?: string | undefined;
  requestUrl?: string | undefined;
}

/**
 * Latency threshold breach — developer-focused performance triage.
 */
export function latencyAlertTemplate(input: LatencyAlertInput): EmailTemplate {
  const severity = input.severity ?? 'warning';
  const tone = severityTone(severity);
  const ruleName = input.ruleName || `${input.percentile} latency${input.endpoint ? ` · ${stripControl(input.endpoint)}` : ''}`;

  // 1. PERFORMANCE
  const perfRows: DataRow[] = [
    { label: `${input.percentile.toUpperCase()} latency`, value: input.observed },
    { label: 'Threshold', value: input.threshold },
  ];
  if (input.aboveThreshold) {
    perfRows.push({ label: 'Above threshold', value: input.aboveThreshold, tone });
  }
  if (input.window) {
    perfRows.push({ label: 'Evaluation window', value: input.window });
  }
  if (typeof input.sampleSize === 'number') {
    perfRows.push({ label: 'Sample count', value: String(input.sampleSize) });
  }

  // 2. REQUEST
  const reqRows: DataRow[] = [];
  if (input.endpoint) {
    const routeVal = input.method ? `${String(input.method).toUpperCase()} ${input.endpoint}` : input.endpoint;
    reqRows.push({ label: 'Route', value: routeVal, sans: true });
  }
  if (input.method && !input.endpoint) {
    reqRows.push({ label: 'Method', value: String(input.method).toUpperCase() });
  }
  if (input.statusCode !== undefined && input.statusCode !== null && String(input.statusCode).trim() !== '') {
    reqRows.push({ label: 'HTTP status', value: String(input.statusCode) });
  }
  if (input.duration || input.observed) {
    reqRows.push({ label: 'Duration', value: input.duration || input.observed });
  }
  if (input.service) {
    reqRows.push({ label: 'Service', value: input.service, sans: true });
  }
  if (input.release) {
    reqRows.push({ label: 'Release', value: input.release });
  }

  // 3. CORRELATION
  const corrRows: DataRow[] = [];
  if (input.requestId) {
    corrRows.push({ label: 'Request', value: input.requestId });
  }
  if (input.tracePublicId || input.traceId) {
    corrRows.push({ label: 'Trace', value: input.tracePublicId || input.traceId || '' });
  }
  if (input.spanPublicId || input.spanId) {
    corrRows.push({ label: 'Span', value: input.spanPublicId || input.spanId || '' });
  }
  if (input.clientIp) {
    corrRows.push({ label: 'Client IP', value: input.clientIp });
  }
  if (input.extraRows && input.extraRows.length > 0) {
    corrRows.push(...input.extraRows);
  }

  // 4. METADATA
  const metaRows: DataRow[] = [];
  if (input.projectName) metaRows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) metaRows.push({ label: 'Environment', value: input.environment });
  if (input.startedAt) metaRows.push({ label: 'Started', value: input.startedAt });

  // 5. ACTIONS
  const primaryAction = input.traceUrl
    ? { url: input.traceUrl, label: 'Analyze Trace', tone }
    : input.requestUrl
      ? { url: input.requestUrl, label: 'View Request', tone }
      : input.alertUrl
        ? { url: input.alertUrl, label: 'View Alert', tone }
        : undefined;

  const secondaryAction = input.traceUrl && input.requestUrl
    ? { url: input.requestUrl, label: 'View Request' }
    : input.traceUrl && input.alertUrl
      ? { url: input.alertUrl, label: 'View Alert' }
      : input.acknowledgeUrl
        ? { url: input.acknowledgeUrl, label: 'Acknowledge' }
        : undefined;

  const actions = developerAlertActions({
    primary: primaryAction,
    secondary: secondaryAction,
    viewAlertUrl: input.alertUrl,
    acknowledgeUrl: input.acknowledgeUrl,
    silenceUrl: input.silenceUrl,
  });

  const contributors =
    input.topContributors && input.topContributors.length > 0
      ? callout('neutral', input.topContributors.map((c) => esc(c)).join('<br />'), 'Slowest operations')
      : '';

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(`${esc(input.percentile.toUpperCase())} response time is above configured threshold${input.endpoint ? ` on ${esc(input.endpoint)}` : ''}.`),
    metricCompare({
      label: input.window ? `${input.percentile.toUpperCase()} · ${input.window}` : `${input.percentile.toUpperCase()} latency`,
      value: input.observed,
      threshold: input.threshold,
      tone,
    }),
    sectionHeader('PERFORMANCE'),
    dataTable(perfRows),
  ];

  if (reqRows.length > 0) {
    bodyBlocks.push(sectionHeader('TARGET & ROUTE'), dataTable(reqRows));
  }
  if (corrRows.length > 0) {
    bodyBlocks.push(sectionHeader('DISTRIBUTED TRACE & NETWORK'), dataTable(corrRows));
  }
  if (contributors) {
    bodyBlocks.push(contributors);
  }
  if (input.insight) {
    bodyBlocks.push(sectionHeader('AI DIAGNOSIS'), aiInsight(input.insight));
  }
  if (actions.html) {
    bodyBlocks.push(sectionHeader('TRIAGE & ACTIONS'), actions.html);
  }
  if (metaRows.length > 0) {
    bodyBlocks.push(sectionHeader('INCIDENT SCOPE'), dataTable(metaRows));
  }

  const textSections: (string | null | undefined | false)[] = [
    `LATENCY ALERT — ${severity.toUpperCase()}`,
    `${input.percentile.toUpperCase()} is ${input.observed} (threshold ${input.threshold})${input.window ? ` over ${input.window}` : ''}.`,
    `\n--- PERFORMANCE ---`,
    plainRows(perfRows),
  ];
  if (reqRows.length > 0) {
    textSections.push(`\n--- TARGET & ROUTE ---`, plainRows(reqRows));
  }
  if (corrRows.length > 0) {
    textSections.push(`\n--- DISTRIBUTED TRACE ---`, plainRows(corrRows));
  }
  if (input.insight) {
    textSections.push(`\n--- AI DIAGNOSIS ---`, `AI Insight: ${input.insight.text}${input.insight.confidence ? ` (Confidence: ${input.insight.confidence}%)` : ''}`);
  }
  if (actions.text) {
    textSections.push(`\n--- ACTIONS ---`, actions.text);
  }
  if (metaRows.length > 0) {
    textSections.push(`\n--- INCIDENT SCOPE ---`, plainRows(metaRows));
  }

  return {
    subject: alertSubject('firing', severity, ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: `${input.percentile.toUpperCase()} latency above threshold`,
      eyebrowText: `Latency · ${severity}`,
      preheader: `${stripControl(input.percentile)} is ${stripControl(input.observed)} against a ${stripControl(input.threshold)} threshold${input.endpoint ? ` on ${stripControl(input.endpoint)}` : ''}.`,
      tone,
      chip: glyph.gauge,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(...textSections),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   8b. ERROR ALERT (DEVELOPER-FOCUSED)
   ════════════════════════════════════════════════════════════════════════ */

export interface ErrorAlertInput extends AlertScope {
  ruleName: string;
  errorName?: string | undefined;
  errorMessage?: string | undefined;
  errorId?: string | undefined;
  fingerprint?: string | undefined;
  handled?: boolean | string | undefined;
  mechanism?: string | undefined;
  sourceFrame?: string | undefined;
  sourceFunction?: string | undefined;
  sourceContext?: string | undefined;
  endpoint?: string | undefined;
  method?: string | undefined;
  statusCode?: string | number | undefined;
  requestId?: string | undefined;
  occurrences?: number | undefined;
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  service?: string | undefined;
  release?: string | undefined;
  framework?: string | undefined;
  traceId?: string | undefined;
  tracePublicId?: string | undefined;
  spanId?: string | undefined;
  spanPublicId?: string | undefined;
  clientIp?: string | undefined;
  severity?: AlertSeverity | undefined;
  startedAt?: string | undefined;
  insight?: AlertInsight | undefined;
  extraRows?: DataRow[] | undefined;
  traceUrl?: string | undefined;
  errorUrl?: string | undefined;
  eventUrl?: string | undefined;
  requestUrl?: string | undefined;
}

/**
 * Developer-focused error alert — identity, normalized stack frame, source excerpt, impact.
 */
export function errorAlertTemplate(input: ErrorAlertInput): EmailTemplate {
  const severity = input.severity ?? 'error';
  const tone = severityTone(severity);
  const ruleName = input.ruleName || 'Unhandled Exception';
  const errorTitle = input.errorName || 'Error';

  // 1. ERROR
  const errorRows: DataRow[] = [
    { label: 'Type', value: errorTitle, tone },
    { label: 'Message', value: input.errorMessage || 'No message provided', sans: true },
  ];
  if (input.errorId) errorRows.push({ label: 'Error ID', value: input.errorId });
  if (input.fingerprint) errorRows.push({ label: 'Fingerprint', value: input.fingerprint });
  if (input.handled !== undefined) {
    const handledStr = typeof input.handled === 'boolean' ? (input.handled ? 'Yes' : 'No') : String(input.handled);
    errorRows.push({ label: 'Handled', value: handledStr });
  }
  if (input.mechanism) errorRows.push({ label: 'Mechanism', value: input.mechanism });

  // 2. SOURCE
  const sourceRows: DataRow[] = [];
  if (input.sourceFrame) sourceRows.push({ label: 'Location', value: input.sourceFrame });
  if (input.sourceFunction) sourceRows.push({ label: 'Function', value: input.sourceFunction });

  // 3. REQUEST
  const reqRows: DataRow[] = [];
  if (input.endpoint) {
    const routeVal = input.method ? `${String(input.method).toUpperCase()} ${input.endpoint}` : input.endpoint;
    reqRows.push({ label: 'Route', value: routeVal, sans: true });
  }
  if (input.method && !input.endpoint) {
    reqRows.push({ label: 'Method', value: String(input.method).toUpperCase() });
  }
  if (input.statusCode !== undefined && input.statusCode !== null && String(input.statusCode).trim() !== '') {
    reqRows.push({ label: 'HTTP status', value: String(input.statusCode) });
  }
  if (input.requestId) reqRows.push({ label: 'Request ID', value: input.requestId });

  // 4. IMPACT
  const impactRows: DataRow[] = [];
  if (typeof input.occurrences === 'number') {
    impactRows.push({ label: 'Occurrences', value: String(input.occurrences) });
  }
  if (input.firstSeenAt) impactRows.push({ label: 'First seen', value: input.firstSeenAt });
  if (input.lastSeenAt) impactRows.push({ label: 'Last seen', value: input.lastSeenAt });

  // 5. RUNTIME
  const runtimeRows: DataRow[] = [];
  if (input.service) runtimeRows.push({ label: 'Service', value: input.service, sans: true });
  if (input.environment) runtimeRows.push({ label: 'Environment', value: input.environment });
  if (input.release) runtimeRows.push({ label: 'Release', value: input.release });
  if (input.framework) runtimeRows.push({ label: 'Framework', value: input.framework });

  // 6. TRACE
  const traceRows: DataRow[] = [];
  if (input.tracePublicId || input.traceId) {
    traceRows.push({ label: 'Trace', value: input.tracePublicId || input.traceId || '' });
  }
  if (input.spanPublicId || input.spanId) {
    traceRows.push({ label: 'Span', value: input.spanPublicId || input.spanId || '' });
  }
  if (input.clientIp) traceRows.push({ label: 'Client IP', value: input.clientIp });
  if (input.extraRows && input.extraRows.length > 0) traceRows.push(...input.extraRows);

  // 7. ACTIONS
  const primaryAction = input.traceUrl
    ? { url: input.traceUrl, label: 'Analyze Trace', tone }
    : (input.errorUrl || input.eventUrl)
      ? { url: (input.errorUrl || input.eventUrl)!, label: 'View Error', tone }
      : input.alertUrl
        ? { url: input.alertUrl, label: 'View Alert', tone }
        : undefined;

  const secondaryAction = input.traceUrl && (input.errorUrl || input.eventUrl)
    ? { url: (input.errorUrl || input.eventUrl)!, label: 'View Error' }
    : input.traceUrl && input.alertUrl
      ? { url: input.alertUrl, label: 'View Alert' }
      : input.acknowledgeUrl
        ? { url: input.acknowledgeUrl, label: 'Acknowledge' }
        : undefined;

  const actions = developerAlertActions({
    primary: primaryAction,
    secondary: secondaryAction,
    viewAlertUrl: input.alertUrl,
    acknowledgeUrl: input.acknowledgeUrl,
    silenceUrl: input.silenceUrl,
  });

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(`An error event triggered alert rule <strong>${esc(ruleName)}</strong>${input.endpoint ? ` on <strong>${esc(input.endpoint)}</strong>` : ''}.`),
    sectionHeader('ERROR'),
    dataTable(errorRows),
  ];

  if (sourceRows.length > 0 || input.sourceContext) {
    bodyBlocks.push(sectionHeader('SOURCE'));
    if (sourceRows.length > 0) bodyBlocks.push(dataTable(sourceRows));
    if (input.sourceContext) bodyBlocks.push(codeBlock(input.sourceContext));
  }

  if (reqRows.length > 0) {
    bodyBlocks.push(sectionHeader('TARGET & ROUTE'), dataTable(reqRows));
  }
  if (impactRows.length > 0) {
    bodyBlocks.push(sectionHeader('IMPACT'), dataTable(impactRows));
  }
  if (runtimeRows.length > 0) {
    bodyBlocks.push(sectionHeader('RUNTIME'), dataTable(runtimeRows));
  }
  if (traceRows.length > 0) {
    bodyBlocks.push(sectionHeader('DISTRIBUTED TRACE & NETWORK'), dataTable(traceRows));
  }
  if (input.insight) {
    bodyBlocks.push(sectionHeader('AI DIAGNOSIS'), aiInsight(input.insight));
  }
  if (actions.html) {
    bodyBlocks.push(sectionHeader('TRIAGE & ACTIONS'), actions.html);
  }

  const textSections: (string | null | undefined | false)[] = [
    `ERROR ALERT — ${severity.toUpperCase()}`,
    `${ruleName}: ${input.errorMessage || errorTitle}`,
    `\n--- ERROR ---`,
    plainRows(errorRows),
  ];
  if (sourceRows.length > 0 || input.sourceContext) {
    textSections.push(`\n--- SOURCE ---`);
    if (sourceRows.length > 0) textSections.push(plainRows(sourceRows));
    if (input.sourceContext) textSections.push(input.sourceContext);
  }
  if (reqRows.length > 0) {
    textSections.push(`\n--- TARGET & ROUTE ---`, plainRows(reqRows));
  }
  if (impactRows.length > 0) {
    textSections.push(`\n--- IMPACT ---`, plainRows(impactRows));
  }
  if (runtimeRows.length > 0) {
    textSections.push(`\n--- RUNTIME ---`, plainRows(runtimeRows));
  }
  if (traceRows.length > 0) {
    textSections.push(`\n--- DISTRIBUTED TRACE ---`, plainRows(traceRows));
  }
  if (input.insight) {
    textSections.push(`\n--- DIAGNOSIS ---`, `AI Insight: ${input.insight.text}${input.insight.confidence ? ` (Confidence: ${input.insight.confidence}%)` : ''}`);
  }
  if (actions.text) {
    textSections.push(`\n--- ACTIONS ---`, actions.text);
  }

  return {
    subject: alertSubject('firing', severity, errorTitle !== 'Error' ? errorTitle : ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: errorTitle !== 'Error' ? `${errorTitle} detected` : 'Error detected',
      eyebrowText: `Error · ${severity}`,
      preheader: `${stripControl(errorTitle)}: ${stripControl(input.errorMessage || ruleName)}${input.endpoint ? ` on ${stripControl(input.endpoint)}` : ''}.`,
      tone,
      chip: glyph.cross,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(...textSections),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   9. ERROR-RATE SPIKE
   ════════════════════════════════════════════════════════════════════════ */

export interface ErrorSpikeInput extends AlertScope {
  /** Observed error rate, pre-formatted, e.g. "12.4%". */
  errorRate: string;
  /** Threshold, pre-formatted, e.g. "2%". */
  threshold: string;
  /** Absolute failing request count. */
  errorCount?: number | undefined;
  /** Total requests in the window. */
  totalRequests?: number | undefined;
  window?: string | undefined;
  /** Dominant status code, e.g. "503". */
  topStatusCode?: string | undefined;
  /** Most frequent error message or exception type. */
  topError?: string | undefined;
  endpoint?: string | undefined;
  /** HTTP method, e.g. "POST". */
  method?: string | undefined;
  /** Distributed trace ID. */
  traceId?: string | undefined;
  /** Distributed span ID. */
  spanId?: string | undefined;
  /** Client IP address. */
  clientIp?: string | undefined;
  /** Service name. */
  service?: string | undefined;
  severity?: AlertSeverity | undefined;
  startedAt?: string | undefined;
  insight?: AlertInsight | undefined;
  extraRows?: DataRow[] | undefined;
  traceUrl?: string | undefined;
  requestUrl?: string | undefined;
}

/**
 * Error-rate spike.
 * Rate and absolute count are both shown with full developer context.
 */
export function errorSpikeTemplate(input: ErrorSpikeInput): EmailTemplate {
  const severity = input.severity ?? 'error';
  const tone = severityTone(severity);
  const ruleName = `Error rate${input.endpoint ? ` · ${stripControl(input.endpoint)}` : ''}`;

  // 1. TARGET & ROUTE
  const reqRows: DataRow[] = [];
  if (input.endpoint) {
    const routeVal = input.method ? `${String(input.method).toUpperCase()} ${input.endpoint}` : input.endpoint;
    reqRows.push({ label: 'Route', value: routeVal, sans: true });
  }
  if (input.method && !input.endpoint) {
    reqRows.push({ label: 'Method', value: String(input.method).toUpperCase() });
  }
  if (input.topStatusCode) {
    reqRows.push({ label: 'Top status', value: input.topStatusCode, tone });
  }
  if (input.service) {
    reqRows.push({ label: 'Service', value: input.service, sans: true });
  }

  // 2. IMPACT & VOLUME
  const impactRows: DataRow[] = [];
  if (typeof input.errorCount === 'number' && typeof input.totalRequests === 'number') {
    impactRows.push({
      label: 'Failed / total',
      value: `${input.errorCount.toLocaleString('en-US')} / ${input.totalRequests.toLocaleString('en-US')}`,
      tone,
    });
  } else if (typeof input.errorCount === 'number') {
    impactRows.push({ label: 'Failed requests', value: input.errorCount.toLocaleString('en-US'), tone });
  }
  if (input.topError) impactRows.push({ label: 'Top error', value: input.topError, sans: true });
  if (input.window) impactRows.push({ label: 'Window', value: input.window });

  // 3. TRACE & NETWORK
  const traceRows: DataRow[] = [];
  if (input.traceId) traceRows.push({ label: 'Trace ID', value: input.traceId });
  if (input.spanId) traceRows.push({ label: 'Span ID', value: input.spanId });
  if (input.clientIp) traceRows.push({ label: 'Client IP', value: input.clientIp });
  if (input.extraRows && input.extraRows.length > 0) traceRows.push(...input.extraRows);

  // 4. INCIDENT SCOPE
  const metaRows: DataRow[] = [
    { label: 'Severity', value: severity.toUpperCase(), tone },
  ];
  if (input.projectName) metaRows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) metaRows.push({ label: 'Environment', value: input.environment });
  if (input.startedAt) metaRows.push({ label: 'Started', value: input.startedAt });

  // 5. ACTIONS
  const primaryAction = input.traceUrl
    ? { url: input.traceUrl, label: 'Analyze Trace', tone }
    : input.requestUrl
      ? { url: input.requestUrl, label: 'View Requests', tone }
      : input.alertUrl
        ? { url: input.alertUrl, label: 'View Alert', tone }
        : undefined;

  const secondaryAction = input.traceUrl && input.alertUrl
    ? { url: input.alertUrl, label: 'View Alert' }
    : input.acknowledgeUrl
      ? { url: input.acknowledgeUrl, label: 'Acknowledge' }
      : undefined;

  const actions = developerAlertActions({
    primary: primaryAction,
    secondary: secondaryAction,
    viewAlertUrl: input.alertUrl,
    acknowledgeUrl: input.acknowledgeUrl,
    silenceUrl: input.silenceUrl,
  });

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(`Requests are failing above the configured error-rate threshold${input.endpoint ? ` on <strong>${esc(input.endpoint)}</strong>` : ''}.`),
    metricCompare({
      label: input.window ? `Error rate · ${input.window}` : 'Error rate',
      value: input.errorRate,
      threshold: input.threshold,
      tone,
    }),
  ];

  if (reqRows.length > 0) {
    bodyBlocks.push(sectionHeader('TARGET & ROUTE'), dataTable(reqRows));
  }
  if (impactRows.length > 0) {
    bodyBlocks.push(sectionHeader('IMPACT & VOLUME'), dataTable(impactRows));
  }
  if (traceRows.length > 0) {
    bodyBlocks.push(sectionHeader('DISTRIBUTED TRACE & NETWORK'), dataTable(traceRows));
  }
  if (metaRows.length > 0) {
    bodyBlocks.push(sectionHeader('INCIDENT SCOPE'), dataTable(metaRows));
  }
  if (input.insight) {
    bodyBlocks.push(sectionHeader('AI DIAGNOSIS'), aiInsight(input.insight));
  }
  if (actions.html) {
    bodyBlocks.push(sectionHeader('TRIAGE & ACTIONS'), actions.html);
  }

  const textSections: (string | null | undefined | false)[] = [
    `ERROR SPIKE — ${severity.toUpperCase()}`,
    `Error rate is ${input.errorRate} (threshold ${input.threshold})${input.window ? ` over ${input.window}` : ''}.`,
  ];
  if (reqRows.length > 0) textSections.push(`\n--- TARGET & ROUTE ---`, plainRows(reqRows));
  if (impactRows.length > 0) textSections.push(`\n--- IMPACT & VOLUME ---`, plainRows(impactRows));
  if (traceRows.length > 0) textSections.push(`\n--- DISTRIBUTED TRACE ---`, plainRows(traceRows));
  if (metaRows.length > 0) textSections.push(`\n--- INCIDENT SCOPE ---`, plainRows(metaRows));
  if (input.insight) textSections.push(`\n--- AI DIAGNOSIS ---`, `AI Insight: ${input.insight.text}${input.insight.confidence ? ` (${Math.round(input.insight.confidence)}% confidence)` : ''}`);
  if (actions.text) textSections.push(`\n--- ACTIONS ---`, actions.text);

  return {
    subject: alertSubject('firing', severity, ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: 'Error rate above threshold',
      eyebrowText: `Errors · ${severity}`,
      preheader: `Error rate is ${stripControl(input.errorRate)} against a ${stripControl(input.threshold)} threshold${input.endpoint ? ` on ${stripControl(input.endpoint)}` : ''}.`,
      tone,
      chip: glyph.cross,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(...textSections),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   10. SERVICE HEALTH
   ════════════════════════════════════════════════════════════════════════ */

export type ServiceHealthStatus = 'down' | 'degraded' | 'recovered';

export interface ServiceHealthInput extends AlertScope {
  serviceName: string;
  status: ServiceHealthStatus;
  /** What the check observed, e.g. "connection refused", "HTTP 503". */
  detail?: string | undefined;
  /** Endpoint or check that reported it. */
  checkUrl?: string | undefined;
  /** Region or probe location. */
  region?: string | undefined;
  /** Consecutive failed checks before firing. */
  failedChecks?: number | undefined;
  /** Downtime duration for `recovered`, pre-formatted. */
  downtime?: string | undefined;
  /** Rolling availability, pre-formatted, e.g. "99.94%". */
  availability?: string | undefined;
  observedAt?: string | undefined;
  insight?: AlertInsight | undefined;
}

const HEALTH_META: Record<
  ServiceHealthStatus,
  { tone: Tone; label: string; state: string; chip: string; severity: AlertSeverity | null }
> = {
  down: { tone: 'danger', label: 'Down', state: 'down', chip: glyph.cross, severity: 'critical' },
  degraded: { tone: 'warning', label: 'Degraded', state: 'degraded', chip: glyph.wave, severity: 'warning' },
  recovered: { tone: 'success', label: 'Recovered', state: 'recovered', chip: glyph.check, severity: null },
};

/**
 * Availability transition — a service went down, degraded, or came back.
 */
export function serviceHealthTemplate(input: ServiceHealthInput): EmailTemplate {
  const meta = HEALTH_META[input.status];

  // 1. HEALTH & AVAILABILITY
  const healthRows: DataRow[] = [
    { label: 'Service', value: input.serviceName, sans: true },
    { label: 'Status', value: meta.label.toUpperCase(), tone: meta.tone },
  ];
  if (typeof input.failedChecks === 'number') {
    healthRows.push({ label: 'Failed checks', value: String(input.failedChecks), tone: meta.tone });
  }
  if (input.downtime) healthRows.push({ label: 'Downtime', value: input.downtime, tone: 'warning' });
  if (input.availability) healthRows.push({ label: 'Availability', value: input.availability });
  if (input.region) healthRows.push({ label: 'Probe region', value: input.region });
  if (input.checkUrl) healthRows.push({ label: 'Check endpoint', value: input.checkUrl });

  // 2. INCIDENT SCOPE
  const ctxRows: DataRow[] = [];
  if (input.projectName) ctxRows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) ctxRows.push({ label: 'Environment', value: input.environment });
  if (input.observedAt) ctxRows.push({ label: 'Observed at', value: input.observedAt });

  const lead =
    input.status === 'recovered'
      ? `${esc(input.serviceName)} is responding normally again${input.downtime ? ` after ${esc(input.downtime)} of downtime` : ''}.`
      : input.status === 'degraded'
        ? `${esc(input.serviceName)} is responding, but outside its healthy operating envelope.`
        : `${esc(input.serviceName)} is not responding to automated health checks.`;

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(lead),
    pill(meta.label, meta.tone),
    sectionHeader('HEALTH & AVAILABILITY'),
    dataTable(healthRows),
  ];

  if (ctxRows.length > 0) {
    bodyBlocks.push(sectionHeader('INCIDENT SCOPE'), dataTable(ctxRows));
  }

  if (input.detail) {
    bodyBlocks.push(callout(meta.tone, esc(input.detail), 'Observation detail'));
  }

  if (input.insight) {
    bodyBlocks.push(sectionHeader('AI DIAGNOSIS'), aiInsight(input.insight));
  }

  if (input.status === 'recovered') {
    if (input.alertUrl) {
      bodyBlocks.push(sectionHeader('TIMELINE'), button(input.alertUrl, 'View Incident Timeline'));
    }
  } else {
    bodyBlocks.push(
      sectionHeader('ACTIONS'),
      alertActions(input, 'View Service', { url: input.acknowledgeUrl, label: 'Acknowledge' }, meta.tone),
    );
  }

  const textSections: (string | null | undefined | false)[] = [
    `SERVICE ${meta.label.toUpperCase()}`,
    lead,
    `\n--- HEALTH & AVAILABILITY ---`,
    plainRows(healthRows),
  ];
  if (ctxRows.length > 0) textSections.push(`\n--- INCIDENT SCOPE ---`, plainRows(ctxRows));
  if (input.detail) textSections.push(`\nObservation: ${input.detail}`);
  if (input.status === 'recovered') {
    if (input.alertUrl) textSections.push(`\nView timeline: ${safeUrlText(input.alertUrl)}`);
  } else {
    textSections.push(actionsText(input, { label: 'Acknowledge:  ', url: input.acknowledgeUrl }));
  }

  return {
    subject: alertSubject(
      input.status === 'recovered' ? 'recovered' : `service ${meta.state}`,
      meta.severity,
      input.serviceName,
      input,
    ),
    html: renderLayout({
      appName: input.appName,
      title:
        input.status === 'recovered'
          ? `${input.serviceName} recovered`
          : `${input.serviceName} is ${meta.state}`,
      eyebrowText: `Availability · ${meta.state}`,
      preheader:
        input.status === 'recovered'
          ? `${stripControl(input.serviceName)} is healthy again${input.downtime ? ` after ${stripControl(input.downtime)}` : ''}.`
          : `${stripControl(input.serviceName)} is ${meta.state}${input.detail ? ` — ${stripControl(input.detail)}` : ''}.`,
      tone: meta.tone,
      chip: meta.chip,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(...textSections),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   11. QUOTA THRESHOLD
   ════════════════════════════════════════════════════════════════════════ */

export interface QuotaAlertInput extends AlertScope {
  /** What is being consumed, e.g. "Events ingested", "Log volume". */
  resource: string;
  /** Consumed amount, pre-formatted, e.g. "8.6M". */
  used: string;
  /** Plan limit, pre-formatted, e.g. "10M". */
  limit: string;
  /** Percentage consumed, 0–100+. */
  percentUsed: number;
  /** When the quota window resets, pre-formatted. */
  resetsAt?: string | undefined;
  /** Plan name. */
  planName?: string | undefined;
  /** What happens at 100% — throttling, overage billing, hard stop. */
  overagePolicy?: string | undefined;
  upgradeUrl?: string | undefined;
  usageUrl?: string | undefined;
}

function quotaActions(input: QuotaAlertInput, tone: Tone): string {
  if (input.upgradeUrl && input.usageUrl) {
    return buttonRow(
      { url: input.upgradeUrl, label: 'Increase limit', tone },
      { url: input.usageUrl, label: 'View usage' },
    );
  }
  if (input.upgradeUrl) return button(input.upgradeUrl, 'Increase limit', { tone });
  if (input.usageUrl) return button(input.usageUrl, 'View usage');
  return '';
}

/**
 * Usage-quota warning.
 */
export function quotaAlertTemplate(input: QuotaAlertInput): EmailTemplate {
  const pct = Math.round(input.percentUsed);
  const exceeded = pct >= 100;
  const tone: Tone = exceeded ? 'danger' : pct >= 80 ? 'warning' : 'info';
  const state = exceeded ? 'exceeded' : 'approaching limit';

  const quotaRows: DataRow[] = [
    { label: 'Resource', value: input.resource, sans: true },
    { label: 'Consumed', value: `${input.used} of ${input.limit}`, tone },
    { label: 'Utilization', value: `${pct}%`, tone },
  ];
  if (input.planName) quotaRows.push({ label: 'Current plan', value: input.planName, sans: true });
  if (input.resetsAt) quotaRows.push({ label: 'Billing resets', value: input.resetsAt });
  if (input.projectName) quotaRows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.orgName) quotaRows.push({ label: 'Organization', value: input.orgName, sans: true });

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(
      exceeded
        ? `Your <strong>${esc(input.resource.toLowerCase())}</strong> quota is fully consumed for this billing period.`
        : `Your <strong>${esc(input.resource.toLowerCase())}</strong> quota is <strong>${pct}%</strong> consumed for this billing period.`,
    ),
    metricCompare({
      label: input.resource,
      value: input.used,
      threshold: input.limit,
      thresholdLabel: 'Plan limit',
      tone,
    }),
    sectionHeader('RESOURCE UTILIZATION'),
    dataTable(quotaRows),
  ];

  if (input.overagePolicy) {
    bodyBlocks.push(
      callout(exceeded ? 'danger' : 'warning', esc(input.overagePolicy), exceeded ? 'In effect now' : 'What happens at 100%'),
    );
  }

  const actHtml = quotaActions(input, tone);
  if (actHtml) {
    bodyBlocks.push(sectionHeader('ACTIONS'), actHtml);
  }

  return {
    subject: `[QUOTA${exceeded ? ' · EXCEEDED' : ''}] ${stripControl(input.resource)} at ${pct}%${scopeLabel(input) ? ` — ${scopeLabel(input)}` : ''}`,
    html: renderLayout({
      appName: input.appName,
      title: exceeded ? `${input.resource} quota exceeded` : `${input.resource} quota at ${pct}%`,
      eyebrowText: `Usage · ${state}`,
      preheader: `${stripControl(input.used)} of ${stripControl(input.limit)} ${stripControl(input.resource.toLowerCase())} used${input.resetsAt ? ` — resets ${stripControl(input.resetsAt)}` : ''}.`,
      tone,
      chip: exceeded ? glyph.bang : glyph.arrowUp,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `USAGE QUOTA ${exceeded ? 'EXCEEDED' : `AT ${pct}%`}`,
      `${input.resource}: ${input.used} of ${input.limit} used (${pct}%).`,
      `\n--- RESOURCE UTILIZATION ---`,
      plainRows(quotaRows),
      input.overagePolicy ? `\nPolicy: ${input.overagePolicy}` : '',
      input.upgradeUrl ? `Increase limit: ${safeUrlText(input.upgradeUrl)}` : '',
      input.usageUrl ? `View usage:     ${safeUrlText(input.usageUrl)}` : '',
    ),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   12. NOTIFICATION DELIVERY FAILURE
   ════════════════════════════════════════════════════════════════════════ */

export interface DeliveryFailureInput extends AlertScope {
  /** Connector that failed, e.g. "Slack #ops", "PagerDuty primary". */
  connectorName: string;
  connectorType?: string | undefined;
  /** How many notifications failed. */
  failedCount: number;
  /** Last error returned by the connector. */
  lastError?: string | undefined;
  /** HTTP status from the last attempt. */
  statusCode?: number | undefined;
  /** Attempts already made. */
  attempts?: number | undefined;
  /** Whether the payload landed in the dead-letter queue. */
  deadLettered?: boolean | undefined;
  firstFailedAt?: string | undefined;
  lastFailedAt?: string | undefined;
  /** Link to connector settings. */
  connectorUrl?: string | undefined;
}

/**
 * Meta-alert: the alerting system itself could not deliver.
 */
export function deliveryFailureTemplate(input: DeliveryFailureInput): EmailTemplate {
  const rows: DataRow[] = [
    { label: 'Connector', value: input.connectorName, sans: true },
  ];
  if (input.connectorType) rows.push({ label: 'Channel type', value: input.connectorType });
  rows.push({ label: 'Failed deliveries', value: `${input.failedCount} notification${input.failedCount === 1 ? '' : 's'}`, tone: 'danger' });
  if (typeof input.attempts === 'number') rows.push({ label: 'Attempts', value: String(input.attempts) });
  if (typeof input.statusCode === 'number') {
    rows.push({ label: 'Last HTTP status', value: String(input.statusCode), tone: 'danger' });
  }
  if (input.firstFailedAt) rows.push({ label: 'First failure', value: input.firstFailedAt });
  if (input.lastFailedAt) rows.push({ label: 'Last failure', value: input.lastFailedAt });
  if (input.deadLettered !== undefined) {
    rows.push({
      label: 'Dead-lettered',
      value: input.deadLettered ? 'Yes — retained for replay' : 'No',
      tone: input.deadLettered ? 'warning' : 'neutral',
      sans: true,
    });
  }
  if (input.orgName) rows.push({ label: 'Organization', value: input.orgName, sans: true });

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(
      `${esc(input.appName)} could not deliver <strong>${input.failedCount}</strong> alert notification${input.failedCount === 1 ? '' : 's'} through <strong>${esc(input.connectorName)}</strong>. Those alerts fired correctly &mdash; but notifications failed to dispatch.`,
    ),
    pill('Delivery failing', 'danger'),
    sectionHeader('CONNECTOR FAILURE DETAILS'),
    dataTable(rows),
  ];

  if (input.lastError) {
    bodyBlocks.push(callout('danger', esc(input.lastError), 'Connector error response'));
  }

  bodyBlocks.push(
    callout(
      'danger',
      'Until this connector is repaired, alerts routed through it are invisible to whoever depends on it. Verify the webhook URL or credential and send a test notification to confirm delivery.',
      'Silent-failure risk',
    ),
  );

  if (input.connectorUrl) {
    bodyBlocks.push(sectionHeader('ACTIONS'), button(input.connectorUrl, 'Manage Connector Settings', { tone: 'danger' }));
  }

  return {
    subject: `[DELIVERY FAILED] ${stripControl(input.connectorName)} — ${input.failedCount} notification${input.failedCount === 1 ? '' : 's'}`,
    html: renderLayout({
      appName: input.appName,
      title: 'Alert delivery is failing',
      eyebrowText: 'System · delivery failure',
      preheader: `${input.failedCount} notification${input.failedCount === 1 ? '' : 's'} could not be delivered through ${stripControl(input.connectorName)}.`,
      tone: 'danger',
      chip: glyph.bang,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      'ALERT DELIVERY FAILING',
      `${input.appName} could not deliver ${input.failedCount} alert notification${input.failedCount === 1 ? '' : 's'} through ${input.connectorName}.`,
      `\n--- FAILURE DETAILS ---`,
      plainRows(rows),
      input.lastError ? `\nLast error: ${input.lastError}` : '',
      input.connectorUrl ? `Manage connector: ${safeUrlText(input.connectorUrl)}` : '',
    ),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   13. ALERT RULE CHANGED
   ════════════════════════════════════════════════════════════════════════ */

export interface RuleChangedInput extends AlertScope {
  ruleName: string;
  action: 'created' | 'updated' | 'disabled' | 'deleted';
  changedBy: string;
  changedAt?: string | undefined;
  /** Field-level summary, e.g. ["Threshold 800ms → 1500ms"]. */
  changes?: string[] | undefined;
  ruleUrl?: string | undefined;
}

const RULE_ACTION_META: Record<RuleChangedInput['action'], { tone: Tone; chip: string; verb: string }> = {
  created: { tone: 'success', chip: glyph.plus, verb: 'created' },
  updated: { tone: 'info', chip: glyph.refresh, verb: 'updated' },
  disabled: { tone: 'warning', chip: glyph.pause, verb: 'disabled' },
  deleted: { tone: 'danger', chip: glyph.cross, verb: 'deleted' },
};

/**
 * Alert-rule audit notice.
 */
export function ruleChangedTemplate(input: RuleChangedInput): EmailTemplate {
  const meta = RULE_ACTION_META[input.action];

  const rows: DataRow[] = [
    { label: 'Rule name', value: input.ruleName, sans: true },
    { label: 'Audit action', value: meta.verb.toUpperCase(), tone: meta.tone },
    { label: 'Modified by', value: input.changedBy, sans: true },
  ];
  if (input.changedAt) rows.push({ label: 'Timestamp', value: input.changedAt });
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) rows.push({ label: 'Environment', value: input.environment });

  const bodyBlocks: (string | null | undefined | false)[] = [
    p(`<strong>${esc(input.changedBy)}</strong> ${esc(meta.verb)} the alert rule <strong>${esc(input.ruleName)}</strong>.`),
    pill(meta.verb, meta.tone),
    sectionHeader('AUDIT TRAIL'),
    dataTable(rows),
  ];

  if (input.changes && input.changes.length > 0) {
    bodyBlocks.push(callout('neutral', input.changes.map((c) => esc(c)).join('<br />'), 'Modified parameters'));
  }

  if (input.action === 'disabled') {
    bodyBlocks.push(
      callout(
        'warning',
        'While this rule is disabled, nothing it watches will alert anyone. That is a gap in coverage, not a reduction in noise — re-enable it when the reason for disabling it has passed.',
        'Coverage gap warning',
      ),
    );
  } else if (input.action === 'deleted') {
    bodyBlocks.push(
      callout(
        'danger',
        'This rule no longer exists. Whatever condition it watched will not be detected again unless an equivalent rule is created.',
        'Coverage removed',
      ),
    );
  }

  if (input.ruleUrl) {
    bodyBlocks.push(sectionHeader('ACTIONS'), button(input.ruleUrl, 'View Rule Configuration'));
  }

  return {
    subject: `[RULE ${meta.verb.toUpperCase()}] ${stripControl(input.ruleName)}${scopeLabel(input) ? ` — ${scopeLabel(input)}` : ''}`,
    html: renderLayout({
      appName: input.appName,
      title: `Alert rule ${meta.verb}`,
      eyebrowText: `Configuration · rule ${meta.verb}`,
      preheader: `${stripControl(input.changedBy)} ${meta.verb} ${stripControl(input.ruleName)}.`,
      tone: meta.tone,
      chip: meta.chip,
      body: stack(bodyBlocks),
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `ALERT RULE ${meta.verb.toUpperCase()}`,
      `${input.changedBy} ${meta.verb} the alert rule "${input.ruleName}".`,
      `\n--- AUDIT TRAIL ---`,
      plainRows(rows),
      input.changes && input.changes.length > 0
        ? `Modified parameters:\n${input.changes.map((c) => `  - ${c}`).join('\n')}`
        : '',
      input.ruleUrl ? `View rule: ${safeUrlText(input.ruleUrl)}` : '',
    ),
  };
}

/* ── end of alert templates ── */
