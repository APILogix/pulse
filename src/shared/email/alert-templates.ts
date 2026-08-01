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
  button,
  buttonRow,
  callout,
  dataTable,
  digestList,
  esc,
  glyph,
  heading,
  metricCompare,
  p,
  pill,
  renderLayout,
  safeUrlText,
  stack,
  statStrip,
  stripControl,
  textBody,
  textRows,
  type DataRow,
  type DigestItem,
} from './components.js';
import { severityGlyph, severityTone, type AlertSeverity, type Tone } from './theme.js';
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
  if (identity.fingerprint) rows.push({ label: 'Fingerprint', value: identity.fingerprint });
  if (identity.eventId) rows.push({ label: 'Event id', value: identity.eventId });
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
}

/**
 * The core alert notification: a rule crossed its threshold and is firing.
 */
export function alertFiringTemplate(input: AlertFiringInput): EmailTemplate {
  const tone = severityTone(input.identity.severity);
  const rows = identityRows(input.identity, input);

  const body = stack([
    input.summary ? p(esc(input.summary)) : '',
    input.measurement ? measurementBlock(input.measurement, tone) : '',
    dataTable(rows),
    input.insight ? aiInsight(input.insight) : '',
    alertActions(input, 'View alert', { url: input.acknowledgeUrl, label: 'Acknowledge' }, tone),
    input.runbook ? callout('neutral', esc(input.runbook), 'First response') : '',
  ]);

  return {
    subject: alertSubject('firing', input.identity.severity, input.identity.ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: input.identity.ruleName,
      eyebrowText: `Firing · ${input.identity.severity}`,
      preheader: input.measurement
        ? `${stripControl(input.measurement.label)} ${stripControl(input.measurement.value)} exceeded ${stripControl(input.measurement.threshold)}${scopeSuffix(input)}.`
        : `${stripControl(input.identity.ruleName)} is firing${scopeSuffix(input)}.`,
      tone,
      chip: severityGlyph(input.identity.severity),
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `ALERT FIRING — ${input.identity.severity.toUpperCase()}`,
      input.summary,
      input.measurement
        ? `${input.measurement.label}: ${input.measurement.value} (threshold ${input.measurement.threshold}${input.measurement.window ? `, ${input.measurement.window}` : ''})`
        : '',
      plainRows(rows),
      input.insight ? `AI insight: ${input.insight.text}${typeof input.insight.confidence === 'number' ? ` (${Math.round(input.insight.confidence)}% confidence)` : ''}` : '',
      actionsText(input, { label: 'Acknowledge:  ', url: input.acknowledgeUrl }),
      input.runbook ? `First response: ${input.runbook}` : '',
    ),
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
 * Recovery notice. Always sent when a firing alert clears — an unresolved
 * "firing" email with no counterpart teaches recipients to distrust the channel.
 * Green here is the truth channel doing its job: a verdict, not decoration.
 */
export function alertResolvedTemplate(input: AlertResolvedInput): EmailTemplate {
  const rows: DataRow[] = [
    { label: 'Rule', value: input.identity.ruleName, sans: true },
    { label: 'Severity', value: input.identity.severity.toUpperCase() },
  ];
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) rows.push({ label: 'Environment', value: input.environment });
  if (input.identity.startedAt) rows.push({ label: 'Started', value: input.identity.startedAt });
  if (input.resolvedAt) rows.push({ label: 'Resolved', value: input.resolvedAt });
  if (input.duration) rows.push({ label: 'Duration', value: input.duration, tone: 'success' });
  if (input.recoveredValue) rows.push({ label: 'Recovered to', value: input.recoveredValue, tone: 'success' });
  if (input.resolvedBy) rows.push({ label: 'Resolved by', value: input.resolvedBy, sans: true });
  if (input.reason) rows.push({ label: 'Reason', value: input.reason, sans: true });
  if (input.identity.fingerprint) rows.push({ label: 'Fingerprint', value: input.identity.fingerprint });

  const body = stack([
    p(
      `${esc(input.identity.ruleName)} has cleared${input.duration ? ` after ${esc(input.duration)}` : ''}. No further action is needed.`,
    ),
    pill('Resolved', 'success'),
    dataTable(rows),
    input.insight ? aiInsight(input.insight) : '',
    input.alertUrl ? button(input.alertUrl, 'View timeline') : '',
  ]);

  return {
    subject: alertSubject('resolved', null, input.identity.ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: `Resolved: ${input.identity.ruleName}`,
      eyebrowText: 'Resolved',
      preheader: `${stripControl(input.identity.ruleName)} cleared${input.duration ? ` after ${stripControl(input.duration)}` : ''}${scopeSuffix(input)}.`,
      tone: 'success',
      chip: glyph.check,
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      'ALERT RESOLVED',
      `${input.identity.ruleName} has cleared${input.duration ? ` after ${input.duration}` : ''}.`,
      plainRows(rows),
      input.alertUrl ? `View timeline: ${safeUrlText(input.alertUrl)}` : '',
    ),
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
 * Acknowledgement notice — tells the rest of the rotation the alert is owned,
 * which is the single most effective way to stop three people debugging the
 * same incident in parallel.
 */
export function alertAcknowledgedTemplate(input: AlertAcknowledgedInput): EmailTemplate {
  const rows: DataRow[] = [
    { label: 'Rule', value: input.identity.ruleName, sans: true },
    { label: 'Owner', value: input.acknowledgedBy, sans: true, tone: 'info' },
  ];
  if (input.acknowledgedAt) rows.push({ label: 'Acknowledged', value: input.acknowledgedAt });
  if (input.expiresAt) rows.push({ label: 'Ack expires', value: input.expiresAt, tone: 'warning' });
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) rows.push({ label: 'Environment', value: input.environment });
  if (input.identity.fingerprint) rows.push({ label: 'Fingerprint', value: input.identity.fingerprint });

  const body = stack([
    p(`${esc(input.acknowledgedBy)} has taken ownership of this alert. It is being worked on.`),
    pill('Acknowledged', 'info'),
    dataTable(rows),
    input.comment ? callout('neutral', esc(input.comment), 'Responder note') : '',
    input.expiresAt
      ? callout(
          'warning',
          `Escalation is paused until ${esc(input.expiresAt)}. If the alert is still firing then, the escalation policy resumes automatically.`,
          'Escalation paused',
        )
      : '',
    input.alertUrl ? button(input.alertUrl, 'View alert') : '',
  ]);

  return {
    subject: alertSubject('acknowledged', null, input.identity.ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: `Acknowledged: ${input.identity.ruleName}`,
      eyebrowText: 'Acknowledged',
      preheader: `${stripControl(input.acknowledgedBy)} is on it — escalation is paused.`,
      tone: 'info',
      chip: glyph.dot,
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      'ALERT ACKNOWLEDGED',
      `${input.acknowledgedBy} has taken ownership of ${input.identity.ruleName}.`,
      plainRows(rows),
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
 *
 * Always rendered in the danger tone regardless of the rule's own severity:
 * escalation means the process failed, and that is a more urgent fact than the
 * original threshold.
 */
export function alertEscalatedTemplate(input: AlertEscalatedInput): EmailTemplate {
  const step = input.totalSteps
    ? `Step ${input.stepNumber} of ${input.totalSteps}`
    : `Step ${input.stepNumber}`;

  const rows: DataRow[] = [
    { label: 'Rule', value: input.identity.ruleName, sans: true },
    { label: 'Severity', value: input.identity.severity.toUpperCase(), tone: severityTone(input.identity.severity) },
    { label: 'Policy', value: input.policyName, sans: true },
    { label: 'Step', value: step, tone: 'danger' },
  ];
  if (input.firingFor) rows.push({ label: 'Firing for', value: input.firingFor, tone: 'danger' });
  if (input.trigger) rows.push({ label: 'Trigger', value: input.trigger, sans: true });
  if (input.notifying) rows.push({ label: 'Notifying', value: input.notifying, sans: true });
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) rows.push({ label: 'Environment', value: input.environment });
  if (input.identity.fingerprint) rows.push({ label: 'Fingerprint', value: input.identity.fingerprint });

  const body = stack([
    p(
      `This alert has not been acknowledged, so ${esc(input.policyName)} advanced to ${esc(step.toLowerCase())} and widened the notification.`,
    ),
    dataTable(rows),
    alertActions(input, 'Take ownership', { url: input.acknowledgeUrl, label: 'Acknowledge' }, 'danger'),
    callout(
      'danger',
      'Acknowledging stops further escalation. Silencing suppresses notifications without resolving the underlying condition — prefer acknowledgement while you investigate.',
      'How to stop escalation',
    ),
  ]);

  return {
    subject: alertSubject(`escalated s${input.stepNumber}`, input.identity.severity, input.identity.ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: `Escalated: ${input.identity.ruleName}`,
      eyebrowText: `Escalated · ${step.toLowerCase()}`,
      preheader: `Unacknowledged${input.firingFor ? ` for ${stripControl(input.firingFor)}` : ''} — ${stripControl(input.policyName)} escalated to ${step.toLowerCase()}.`,
      tone: 'danger',
      chip: glyph.arrowUp,
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `ALERT ESCALATED — ${step.toUpperCase()}`,
      `${input.identity.ruleName} was not acknowledged; ${input.policyName} advanced to ${step.toLowerCase()}.`,
      plainRows(rows),
      actionsText(input, { label: 'Acknowledge:  ', url: input.acknowledgeUrl }),
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
 *
 * Suppression is the most dangerous action in an alerting system, so it is
 * announced rather than performed quietly: a forgotten silence is how an outage
 * goes unnoticed for a weekend.
 */
export function alertSilencedTemplate(input: AlertSilencedInput): EmailTemplate {
  const rows: DataRow[] = [
    { label: 'Silenced', value: input.target, sans: true },
    { label: 'Created by', value: input.silencedBy, sans: true },
    { label: 'Expires', value: input.expiresAt, tone: 'warning' },
  ];
  if (input.duration) rows.push({ label: 'Duration', value: input.duration });
  if (typeof input.matchedRules === 'number') {
    rows.push({ label: 'Rules matched', value: String(input.matchedRules), tone: 'warning' });
  }
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) rows.push({ label: 'Environment', value: input.environment });
  if (input.reason) rows.push({ label: 'Reason', value: input.reason, sans: true });

  const body = stack([
    p(
      `Notifications matching ${esc(input.target)} are suppressed until ${esc(input.expiresAt)}. Rules keep evaluating and events keep recording &mdash; only the notifications stop.`,
    ),
    pill('Silenced', 'warning'),
    dataTable(rows),
    input.silenceUrl ? button(input.silenceUrl, 'Manage silence', { tone: 'warning' }) : '',
    callout(
      'warning',
      'Anything this matcher covers will not page anyone while the silence is active. Remove it as soon as the maintenance or noisy deploy that justified it is over.',
      'Coverage gap',
    ),
  ]);

  return {
    subject: alertSubject('silenced', null, input.target, input),
    html: renderLayout({
      appName: input.appName,
      title: 'Alerts silenced',
      eyebrowText: 'Silenced',
      preheader: `${stripControl(input.target)} will not notify anyone until ${stripControl(input.expiresAt)}.`,
      tone: 'warning',
      chip: glyph.pause,
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      'ALERTS SILENCED',
      `Notifications matching ${input.target} are suppressed until ${input.expiresAt}.`,
      plainRows(rows),
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
  const rows: DataRow[] = [];
  if (input.metric) rows.push({ label: 'Metric', value: input.metric, sans: true });
  if (input.baseline) rows.push({ label: 'Baseline', value: input.baseline });
  if (input.deviation) rows.push({ label: 'Deviation', value: input.deviation, tone: 'ai' });
  if (input.window) rows.push({ label: 'Window', value: input.window });
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) rows.push({ label: 'Environment', value: input.environment });
  if (input.detectedAt) rows.push({ label: 'Detected', value: input.detectedAt });

  const insightInput: AlertInsight =
    typeof input.confidence === 'number'
      ? { text: input.explanation, confidence: input.confidence }
      : { text: input.explanation };

  const body = stack([
    input.observed && input.baseline
      ? metricCompare({
          label: input.metric ? `${input.metric} observed` : 'Observed',
          value: input.observed,
          threshold: input.baseline,
          thresholdLabel: 'Baseline',
          tone: 'ai',
        })
      : '',
    aiInsight(insightInput),
    dataTable(rows),
    input.alertUrl ? button(input.alertUrl, 'Investigate', { tone: 'ai' }) : '',
    input.suggestedAction ? callout('ai', esc(input.suggestedAction), 'Suggested next step') : '',
    callout(
      'neutral',
      'This is a statistical detection, not a threshold breach — no rule fired. Treat it as a lead to investigate rather than a confirmed fault.',
      'How to read this',
    ),
  ]);

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
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      'ANOMALY DETECTED (AI)',
      input.title,
      input.explanation,
      typeof input.confidence === 'number' ? `Confidence: ${Math.round(input.confidence)}%` : '',
      input.observed ? `Observed: ${input.observed}${input.baseline ? ` (baseline ${input.baseline})` : ''}` : '',
      rows.length > 0 ? plainRows(rows) : '',
      input.suggestedAction ? `Suggested next step: ${input.suggestedAction}` : '',
      input.alertUrl ? `Investigate: ${safeUrlText(input.alertUrl)}` : '',
      'This is a statistical detection, not a threshold breach.',
    ),
  };
}

/* ════════════════════════════════════════════════════════════════════════
   8. LATENCY THRESHOLD
   ════════════════════════════════════════════════════════════════════════ */

export interface LatencyAlertInput extends AlertScope {
  /** Percentile being watched, e.g. "p95". */
  percentile: string;
  /** Observed latency, pre-formatted with units. */
  observed: string;
  /** Configured threshold, pre-formatted with units. */
  threshold: string;
  /** Evaluation window. */
  window?: string | undefined;
  /** Route or service that is slow. */
  endpoint?: string | undefined;
  /** Sample size behind the percentile — a p95 over 4 requests is noise. */
  sampleSize?: number | undefined;
  /** Slowest contributing operations. */
  topContributors?: string[] | undefined;
  severity?: AlertSeverity | undefined;
  startedAt?: string | undefined;
  insight?: AlertInsight | undefined;
}

/**
 * Latency threshold breach.
 *
 * Matches the `latency_alert` email type already used by the organization email
 * outbox. Sample size is surfaced deliberately: a percentile without its
 * denominator invites false urgency.
 */
export function latencyAlertTemplate(input: LatencyAlertInput): EmailTemplate {
  const severity = input.severity ?? 'warning';
  const tone = severityTone(severity);
  const ruleName = `${input.percentile} latency${input.endpoint ? ` · ${stripControl(input.endpoint)}` : ''}`;

  const rows: DataRow[] = [{ label: 'Percentile', value: input.percentile }];
  if (input.endpoint) rows.push({ label: 'Endpoint', value: input.endpoint });
  if (input.window) rows.push({ label: 'Window', value: input.window });
  if (typeof input.sampleSize === 'number') {
    rows.push({ label: 'Samples', value: String(input.sampleSize) });
  }
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) rows.push({ label: 'Environment', value: input.environment });
  if (input.startedAt) rows.push({ label: 'Started', value: input.startedAt });

  const contributors =
    input.topContributors && input.topContributors.length > 0
      ? callout('neutral', input.topContributors.map((c) => esc(c)).join('<br />'), 'Slowest operations')
      : '';

  const body = stack([
    p(
      `${esc(input.percentile)} response time is above its configured threshold${input.endpoint ? ` on ${esc(input.endpoint)}` : ''}.`,
    ),
    metricCompare({
      label: input.window ? `${input.percentile} · ${input.window}` : input.percentile,
      value: input.observed,
      threshold: input.threshold,
      tone,
    }),
    dataTable(rows),
    contributors,
    input.insight ? aiInsight(input.insight) : '',
    alertActions(input, 'View latency breakdown', { url: input.acknowledgeUrl, label: 'Acknowledge' }, tone),
  ]);

  return {
    subject: alertSubject('firing', severity, ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: `${input.percentile} latency above threshold`,
      eyebrowText: `Latency · ${severity}`,
      preheader: `${stripControl(input.percentile)} is ${stripControl(input.observed)} against a ${stripControl(input.threshold)} threshold${input.endpoint ? ` on ${stripControl(input.endpoint)}` : ''}.`,
      tone,
      chip: glyph.gauge,
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `LATENCY ALERT — ${severity.toUpperCase()}`,
      `${input.percentile} is ${input.observed} (threshold ${input.threshold})${input.window ? ` over ${input.window}` : ''}.`,
      plainRows(rows),
      input.topContributors && input.topContributors.length > 0
        ? `Slowest operations:\n${input.topContributors.map((c) => `  - ${c}`).join('\n')}`
        : '',
      actionsText(input, { label: 'Acknowledge:  ', url: input.acknowledgeUrl }),
    ),
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
  severity?: AlertSeverity | undefined;
  startedAt?: string | undefined;
  insight?: AlertInsight | undefined;
}

/**
 * Error-rate spike.
 *
 * Rate and absolute count are both shown: 50% of two requests and 50% of two
 * million demand very different responses, and a rate alone hides which one
 * you are looking at.
 */
export function errorSpikeTemplate(input: ErrorSpikeInput): EmailTemplate {
  const severity = input.severity ?? 'error';
  const tone = severityTone(severity);
  const ruleName = `Error rate${input.endpoint ? ` · ${stripControl(input.endpoint)}` : ''}`;

  const rows: DataRow[] = [];
  if (typeof input.errorCount === 'number' && typeof input.totalRequests === 'number') {
    rows.push({
      label: 'Failed / total',
      value: `${input.errorCount.toLocaleString('en-US')} / ${input.totalRequests.toLocaleString('en-US')}`,
      tone,
    });
  } else if (typeof input.errorCount === 'number') {
    rows.push({ label: 'Failed requests', value: input.errorCount.toLocaleString('en-US'), tone });
  }
  if (input.topStatusCode) rows.push({ label: 'Top status', value: input.topStatusCode, tone });
  if (input.topError) rows.push({ label: 'Top error', value: input.topError, sans: true });
  if (input.endpoint) rows.push({ label: 'Endpoint', value: input.endpoint });
  if (input.window) rows.push({ label: 'Window', value: input.window });
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) rows.push({ label: 'Environment', value: input.environment });
  if (input.startedAt) rows.push({ label: 'Started', value: input.startedAt });

  const body = stack([
    p(`Requests are failing above the configured error-rate threshold${input.endpoint ? ` on ${esc(input.endpoint)}` : ''}.`),
    metricCompare({
      label: input.window ? `Error rate · ${input.window}` : 'Error rate',
      value: input.errorRate,
      threshold: input.threshold,
      tone,
    }),
    dataTable(rows),
    input.insight ? aiInsight(input.insight) : '',
    alertActions(input, 'View failing requests', { url: input.acknowledgeUrl, label: 'Acknowledge' }, tone),
  ]);

  return {
    subject: alertSubject('firing', severity, ruleName, input),
    html: renderLayout({
      appName: input.appName,
      title: 'Error rate above threshold',
      eyebrowText: `Errors · ${severity}`,
      preheader: `Error rate is ${stripControl(input.errorRate)} against a ${stripControl(input.threshold)} threshold${input.endpoint ? ` on ${stripControl(input.endpoint)}` : ''}.`,
      tone,
      chip: glyph.cross,
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `ERROR SPIKE — ${severity.toUpperCase()}`,
      `Error rate is ${input.errorRate} (threshold ${input.threshold})${input.window ? ` over ${input.window}` : ''}.`,
      rows.length > 0 ? plainRows(rows) : '',
      actionsText(input, { label: 'Acknowledge:  ', url: input.acknowledgeUrl }),
    ),
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
 *
 * All three states share one template so the recovery notice is guaranteed to
 * match the outage notice it closes. Divergent "up" and "down" templates are
 * how recovery mails end up missing fields the outage mail promised.
 */
export function serviceHealthTemplate(input: ServiceHealthInput): EmailTemplate {
  const meta = HEALTH_META[input.status];

  const rows: DataRow[] = [
    { label: 'Service', value: input.serviceName, sans: true },
    { label: 'Status', value: meta.label.toUpperCase(), tone: meta.tone },
  ];
  if (input.detail) rows.push({ label: 'Observation', value: input.detail, sans: true });
  if (input.checkUrl) rows.push({ label: 'Check', value: input.checkUrl });
  if (input.region) rows.push({ label: 'Probe region', value: input.region });
  if (typeof input.failedChecks === 'number') {
    rows.push({ label: 'Failed checks', value: String(input.failedChecks), tone: meta.tone });
  }
  if (input.downtime) rows.push({ label: 'Downtime', value: input.downtime, tone: 'warning' });
  if (input.availability) rows.push({ label: 'Availability', value: input.availability });
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) rows.push({ label: 'Environment', value: input.environment });
  if (input.observedAt) rows.push({ label: 'Observed', value: input.observedAt });

  const lead =
    input.status === 'recovered'
      ? `${esc(input.serviceName)} is responding normally again${input.downtime ? ` after ${esc(input.downtime)} of downtime` : ''}.`
      : input.status === 'degraded'
        ? `${esc(input.serviceName)} is responding, but outside its healthy envelope.`
        : `${esc(input.serviceName)} is not responding to health checks.`;

  const body = stack([
    p(lead),
    pill(meta.label, meta.tone),
    dataTable(rows),
    input.insight ? aiInsight(input.insight) : '',
    input.status === 'recovered'
      ? input.alertUrl
        ? button(input.alertUrl, 'View incident timeline')
        : ''
      : alertActions(input, 'View service', { url: input.acknowledgeUrl, label: 'Acknowledge' }, meta.tone),
  ]);

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
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `SERVICE ${meta.label.toUpperCase()}`,
      input.status === 'recovered'
        ? `${input.serviceName} is responding normally again${input.downtime ? ` after ${input.downtime}` : ''}.`
        : `${input.serviceName} is ${meta.state}.`,
      plainRows(rows),
      // A recovered service has nothing to acknowledge — offering the link
      // would contradict the message.
      input.status === 'recovered'
        ? input.alertUrl
          ? `View timeline: ${safeUrlText(input.alertUrl)}`
          : ''
        : actionsText(input, { label: 'Acknowledge:  ', url: input.acknowledgeUrl }),
    ),
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

/**
 * Quota CTAs.
 *
 * Upgrading is the resolution, so it takes the primary slot; the usage
 * breakdown is the "why", so it takes the secondary. With only one link
 * available that link becomes the sole button rather than half an empty pair.
 */
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
 *
 * Tone follows consumption rather than a fixed severity, because the same
 * message is very different news at 80% and at 100%: over limit is red,
 * approaching is amber, informational is neutral.
 */
export function quotaAlertTemplate(input: QuotaAlertInput): EmailTemplate {
  const pct = Math.round(input.percentUsed);
  const exceeded = pct >= 100;
  const tone: Tone = exceeded ? 'danger' : pct >= 80 ? 'warning' : 'info';
  const state = exceeded ? 'exceeded' : 'approaching limit';

  const rows: DataRow[] = [
    { label: 'Resource', value: input.resource, sans: true },
    { label: 'Used', value: `${input.used} of ${input.limit}`, tone },
    { label: 'Consumed', value: `${pct}%`, tone },
  ];
  if (input.planName) rows.push({ label: 'Plan', value: input.planName, sans: true });
  if (input.resetsAt) rows.push({ label: 'Resets', value: input.resetsAt });
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.orgName) rows.push({ label: 'Organization', value: input.orgName, sans: true });

  const body = stack([
    p(
      exceeded
        ? `Your ${esc(input.resource.toLowerCase())} quota is fully consumed for this billing period.`
        : `Your ${esc(input.resource.toLowerCase())} quota is ${pct}% consumed for this billing period.`,
    ),
    metricCompare({
      label: input.resource,
      value: input.used,
      threshold: input.limit,
      thresholdLabel: 'Plan limit',
      tone,
    }),
    dataTable(rows),
    input.overagePolicy
      ? callout(exceeded ? 'danger' : 'warning', esc(input.overagePolicy), exceeded ? 'In effect now' : 'What happens at 100%')
      : '',
    quotaActions(input, tone),
  ]);

  return {
    subject: `[QUOTA${exceeded ? ' · EXCEEDED' : ''}] ${stripControl(input.resource)} at ${pct}%${scopeLabel(input) ? ` — ${scopeLabel(input)}` : ''}`,
    html: renderLayout({
      appName: input.appName,
      title: exceeded ? `${input.resource} quota exceeded` : `${input.resource} quota at ${pct}%`,
      eyebrowText: `Usage · ${state}`,
      preheader: `${stripControl(input.used)} of ${stripControl(input.limit)} ${stripControl(input.resource.toLowerCase())} used${input.resetsAt ? ` — resets ${stripControl(input.resetsAt)}` : ''}.`,
      tone,
      chip: exceeded ? glyph.bang : glyph.arrowUp,
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `USAGE QUOTA ${exceeded ? 'EXCEEDED' : `AT ${pct}%`}`,
      `${input.resource}: ${input.used} of ${input.limit} used (${pct}%).`,
      plainRows(rows),
      input.overagePolicy ?? '',
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
 *
 * The most important alert in the product, because it is the one that reveals
 * silent failure. A broken Slack webhook means every other alert is being
 * generated correctly and going nowhere, and nobody finds out by waiting.
 * Deliberately routed over email — the channel that is failing cannot be
 * trusted to report its own failure.
 */
export function deliveryFailureTemplate(input: DeliveryFailureInput): EmailTemplate {
  const rows: DataRow[] = [
    { label: 'Connector', value: input.connectorName, sans: true },
  ];
  if (input.connectorType) rows.push({ label: 'Type', value: input.connectorType });
  rows.push({ label: 'Failed', value: `${input.failedCount} notification${input.failedCount === 1 ? '' : 's'}`, tone: 'danger' });
  if (typeof input.attempts === 'number') rows.push({ label: 'Attempts', value: String(input.attempts) });
  if (typeof input.statusCode === 'number') {
    rows.push({ label: 'Last status', value: String(input.statusCode), tone: 'danger' });
  }
  if (input.lastError) rows.push({ label: 'Last error', value: input.lastError, sans: true });
  if (input.firstFailedAt) rows.push({ label: 'First failure', value: input.firstFailedAt });
  if (input.lastFailedAt) rows.push({ label: 'Last failure', value: input.lastFailedAt });
  if (input.deadLettered !== undefined) {
    rows.push({
      label: 'Dead-lettered',
      value: input.deadLettered ? 'Yes — retained for retry' : 'No',
      tone: input.deadLettered ? 'warning' : 'neutral',
      sans: true,
    });
  }
  if (input.orgName) rows.push({ label: 'Organization', value: input.orgName, sans: true });

  const body = stack([
    p(
      `${esc(input.appName)} could not deliver ${input.failedCount} alert notification${input.failedCount === 1 ? '' : 's'} through ${esc(input.connectorName)}. Those alerts fired correctly &mdash; they simply never arrived.`,
    ),
    pill('Delivery failing', 'danger'),
    dataTable(rows),
    input.connectorUrl ? button(input.connectorUrl, 'Fix connector', { tone: 'danger' }) : '',
    callout(
      'danger',
      'Until this connector is repaired, alerts routed through it are invisible to whoever depends on it. Verify the credential or webhook URL, then send a test notification to confirm delivery.',
      'Silent-failure risk',
    ),
    input.deadLettered
      ? callout(
          'neutral',
          'Failed payloads were moved to the dead-letter queue rather than dropped, so they can be replayed once delivery is restored.',
          'Nothing was lost',
        )
      : '',
  ]);

  return {
    subject: `[DELIVERY FAILED] ${stripControl(input.connectorName)} — ${input.failedCount} notification${input.failedCount === 1 ? '' : 's'}`,
    html: renderLayout({
      appName: input.appName,
      title: 'Alert delivery is failing',
      eyebrowText: 'System · delivery failure',
      preheader: `${input.failedCount} notification${input.failedCount === 1 ? '' : 's'} could not be delivered through ${stripControl(input.connectorName)}.`,
      tone: 'danger',
      chip: glyph.bang,
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      'ALERT DELIVERY FAILING',
      `${input.appName} could not deliver ${input.failedCount} alert notification${input.failedCount === 1 ? '' : 's'} through ${input.connectorName}.`,
      plainRows(rows),
      input.connectorUrl ? `Fix connector: ${safeUrlText(input.connectorUrl)}` : '',
      'Until this is repaired, alerts routed through this connector are invisible.',
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
 *
 * Changing a threshold silently changes what the team will and will not be told
 * about. Disabling a rule is functionally an outage in your own observability,
 * so it is announced to the org rather than left in an audit log nobody reads.
 */
export function ruleChangedTemplate(input: RuleChangedInput): EmailTemplate {
  const meta = RULE_ACTION_META[input.action];

  const rows: DataRow[] = [
    { label: 'Rule', value: input.ruleName, sans: true },
    { label: 'Action', value: meta.verb.toUpperCase(), tone: meta.tone },
    { label: 'Changed by', value: input.changedBy, sans: true },
  ];
  if (input.changedAt) rows.push({ label: 'When', value: input.changedAt });
  if (input.projectName) rows.push({ label: 'Project', value: input.projectName, sans: true });
  if (input.environment) rows.push({ label: 'Environment', value: input.environment });

  const changeList =
    input.changes && input.changes.length > 0
      ? callout('neutral', input.changes.map((c) => esc(c)).join('<br />'), 'What changed')
      : '';

  const risk =
    input.action === 'disabled'
      ? callout(
          'warning',
          'While this rule is disabled nothing it watches will alert anyone. That is a gap in coverage, not a reduction in noise — re-enable it when the reason for disabling it has passed.',
          'Coverage gap',
        )
      : input.action === 'deleted'
        ? callout(
            'danger',
            'This rule no longer exists. Whatever condition it watched will not be detected again unless an equivalent rule is created.',
            'Coverage removed',
          )
        : '';

  const body = stack([
    p(`${esc(input.changedBy)} ${esc(meta.verb)} the alert rule ${esc(input.ruleName)}.`),
    dataTable(rows),
    changeList,
    risk,
    input.ruleUrl ? button(input.ruleUrl, 'View rule') : '',
  ]);

  return {
    subject: `[RULE ${meta.verb.toUpperCase()}] ${stripControl(input.ruleName)}${scopeLabel(input) ? ` — ${scopeLabel(input)}` : ''}`,
    html: renderLayout({
      appName: input.appName,
      title: `Alert rule ${meta.verb}`,
      eyebrowText: `Configuration · rule ${meta.verb}`,
      preheader: `${stripControl(input.changedBy)} ${meta.verb} ${stripControl(input.ruleName)}.`,
      tone: meta.tone,
      chip: meta.chip,
      body,
      footer: 'alert',
      footerLink: footerLinkFor(input),
      closing: null,
    }),
    text: textBody(
      `ALERT RULE ${meta.verb.toUpperCase()}`,
      `${input.changedBy} ${meta.verb} the alert rule "${input.ruleName}".`,
      plainRows(rows),
      input.changes && input.changes.length > 0
        ? `What changed:\n${input.changes.map((c) => `  - ${c}`).join('\n')}`
        : '',
      input.ruleUrl ? `View rule: ${safeUrlText(input.ruleUrl)}` : '',
    ),
  };
}

/* ── end of alert templates ── */
