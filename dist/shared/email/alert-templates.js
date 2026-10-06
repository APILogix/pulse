/**
 * Alert & monitoring email templates — Sentinel Mono.
 *
 * These are the on-call surface of the product. They obey a different set of
 * rules from the transactional templates in `./templates.ts`, because the
 * reader is triaging at 03:00, not browsing:
 *
 *   1. **No greeting.** An alert is machine-to-human. It leads with the fact,
 *      not with "Hi,". Every word before the verdict is a word in the way.
 *   2. **Subject is the alert.** A bracketed state tag comes first, so inbox
 *      rules, pager bridges and mobile previews can classify the message from
 *      its first few characters.
 *   3. **Severity is pre-verbal.** The state line under the header strip is a
 *      tinted band with a drawn status dot, so the verdict registers before a
 *      word is parsed — and survives a plaintext-only client via the subject.
 *   4. **Numbers before prose.** The readout band sets the observed value
 *      against its threshold in mono, and the meter beneath draws the
 *      crossing: the stretch past the threshold is the only saturated colour
 *      in the band.
 *   5. **Action before evidence.** One white button, a ghost secondary and
 *      quiet text links sit above the fact sections, so a reader who has
 *      already decided never scrolls past tables to act.
 *   6. **Cyan means a model said it.** AI insight cards are the only cyan in
 *      the email. If cyan appears, inference produced that sentence, and it
 *      arrives with a confidence score attached.
 *   7. **Every alert is identifiable.** Fingerprint and event id ship in the
 *      body so an email can be correlated with the audit log and the dedupe
 *      chain without opening the app.
 *
 * Every rule-based notice shares one anatomy: the state line names the event
 * (firing, resolved, escalated), the headline names the rule, and the facts
 * below are grouped the way the console's detail sheet groups them.
 */
import { aiInsight, button, buttonRow, callout, code, codeBlock, dataTable, digestList, esc, exceptionBlock, lines, metricCompare, note, p, readout, renderLayout, safeUrlText, section, stack, stepTrack, stripControl, strong, textBody, textLinks, textRows, } from './components.js';
import { severityGlyph, severityTone } from './theme.js';
/* ════════════════════════════════════════════════════════════════════════
   SHARED COMPOSITION
   ════════════════════════════════════════════════════════════════════════ */
/** `checkout-api (production)` — the scope line used in subjects. */
function scopeLabel(scope) {
    const project = stripControl(scope.projectName).trim();
    const env = stripControl(scope.environment).trim();
    if (project && env)
        return `${project} (${env})`;
    if (project)
        return project;
    if (env)
        return env;
    return stripControl(scope.orgName).trim();
}
/**
 * ` on checkout-api (production)`, or empty when the caller supplied no scope.
 *
 * Guards the preheader against rendering "… is firing on ." for an org-level
 * alert that has no project or environment attached.
 */
function scopeSuffix(scope) {
    const where = scopeLabel(scope);
    return where ? ` on ${where}` : '';
}
/**
 * Header-strip context — which system is speaking, readable before the
 * headline: `checkout-api · production`, the organization, or "Alerts".
 */
function scopeContext(scope) {
    const project = stripControl(scope.projectName).trim();
    const env = stripControl(scope.environment).trim();
    if (project && env)
        return `${project} · ${env}`;
    return project || env || stripControl(scope.orgName).trim() || 'Alerts';
}
/**
 * On-call subject line: a bracketed state tag, then the rule.
 *
 * Bracketed state first so inbox rules, pager bridges and mobile notification
 * previews can classify the message from its first few characters.
 */
function alertSubject(state, severity, ruleName, scope) {
    let tagText = state.toUpperCase();
    if (state === 'firing') {
        tagText = severity ? severity.toUpperCase() : '';
    }
    else {
        tagText = severity ? `${state.toUpperCase()} · ${severity.toUpperCase()}` : state.toUpperCase();
    }
    const tag = tagText ? `[${tagText}]` : '';
    const rule = stripControl(ruleName).trim() || 'Alert';
    return tag ? `${tag} ${rule}` : rule;
}
/** Capitalise the first letter — state words are sentence case. */
function cap(value) {
    const v = stripControl(value).trim();
    return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}
/** State-line label, `Firing · Critical`. Empty parts are dropped. */
function stateLabel(...parts) {
    return parts
        .map((part) => cap(part ?? ''))
        .filter((part) => part.length > 0)
        .join(' · ');
}
/** The verdict band, carrying its timestamp when the caller supplied one. */
function verdict(labelText, tone, at) {
    const meta = stripControl(at).trim();
    return meta ? { label: labelText, tone, meta } : { label: labelText, tone };
}
function present(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
}
/** 5xx reads red and 4xx amber; anything else is not a verdict. */
function httpTone(statusCode) {
    const n = Number(statusCode);
    if (n >= 500)
        return 'danger';
    if (n >= 400)
        return 'warning';
    return undefined;
}
/** `POST /v1/checkout` — the method folded into the route, the way access logs print it. */
function routeValue(endpoint, method) {
    if (!endpoint)
        return '';
    return method ? `${String(method).toUpperCase()} ${endpoint}` : endpoint;
}
function plainRows(rows) {
    return textRows(rows.map((r) => ({ label: r.label, value: r.value })));
}
/**
 * Plaintext block under a `--- TITLE ---` marker. The marker format is kept
 * from the previous revision because text-only clients and downstream parsers
 * read it; an empty body renders nothing.
 */
function textBlock(title, body) {
    return body ? `--- ${title.toUpperCase()} ---\n${body}` : '';
}
/** Plaintext twin of a fact section: marker, then aligned rows. */
function textSection(title, rows) {
    return rows.length > 0 ? textBlock(title, plainRows(rows)) : '';
}
/** Plaintext twin of an AI insight, confidence attached. */
function insightText(insight) {
    if (!insight)
        return '';
    const conf = typeof insight.confidence === 'number' && Number.isFinite(insight.confidence)
        ? ` (${Math.round(insight.confidence)}% confidence)`
        : '';
    return `AI insight${conf}\n${insight.text}`;
}
/**
 * The readout for a threshold alert: observed value against the threshold it
 * crossed, with the window folded into the label so it sits directly above
 * the numbers it qualifies — a threshold without its window is not a fact.
 */
function measurementHero(m, tone) {
    return metricCompare({
        label: m.window ? `${m.label} · ${m.window}` : m.label,
        value: m.value,
        threshold: m.threshold,
        tone,
    });
}
/** Footer link wiring — notification preferences when the caller supplies it. */
function footerLinkFor(scope) {
    return scope.preferencesUrl
        ? { url: scope.preferencesUrl, label: 'Manage alert notifications' }
        : undefined;
}
/**
 * The decision block — one white button, a ghost secondary, and any remaining
 * paths as quiet text links, in the order given. Duplicate and unsafe URLs are
 * dropped, so the same destination is never offered twice and a missing link
 * never becomes a dead control.
 */
function actionGroup(links) {
    const seen = new Set();
    const usable = [];
    for (const link of links) {
        const href = link.url ? safeUrlText(link.url) : '';
        if (!href || seen.has(href))
            continue;
        seen.add(href);
        usable.push({ url: href, label: link.label });
    }
    const [primary, secondary, ...rest] = usable;
    if (!primary)
        return { html: '', text: '' };
    const buttons = secondary ? buttonRow(primary, secondary) : button(primary.url, primary.label);
    const width = usable.reduce((max, l) => Math.max(max, l.label.length), 0);
    return {
        html: stack([buttons, textLinks(rest)], 16),
        text: usable.map((l) => `${`${l.label}:`.padEnd(width + 2)}${l.url}`).join('\n'),
    };
}
/**
 * The core alert notification: a rule crossed its threshold and is firing.
 *
 * Reading order: the verdict band, the rule, the crossing (readout + meter),
 * the summary and any model insight, the decision, then the evidence grouped
 * as request, incident and correlation facts.
 */
export function alertFiringTemplate(input) {
    const id = input.identity;
    const severity = id.severity;
    const tone = severityTone(severity);
    const requestRows = [];
    const route = routeValue(id.endpoint, id.method);
    if (route)
        requestRows.push({ label: 'Route', value: route });
    else if (id.method)
        requestRows.push({ label: 'Method', value: String(id.method).toUpperCase() });
    if (present(id.statusCode)) {
        requestRows.push({ label: 'HTTP status', value: String(id.statusCode), tone: httpTone(id.statusCode) });
    }
    if (id.duration)
        requestRows.push({ label: 'Time taken', value: id.duration });
    if (id.service)
        requestRows.push({ label: 'Service', value: id.service });
    const incidentRows = [];
    if (input.projectName)
        incidentRows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.environment)
        incidentRows.push({ label: 'Environment', value: input.environment });
    if (id.source)
        incidentRows.push({ label: 'Source', value: id.source });
    if (typeof id.occurrences === 'number') {
        incidentRows.push({ label: 'Occurrences', value: `${id.occurrences} in this window` });
    }
    const correlationRows = [];
    if (id.traceId)
        correlationRows.push({ label: 'Trace ID', value: id.traceId });
    if (id.spanId)
        correlationRows.push({ label: 'Span ID', value: id.spanId });
    if (id.clientIp)
        correlationRows.push({ label: 'Client IP', value: id.clientIp });
    if (id.fingerprint)
        correlationRows.push({ label: 'Fingerprint', value: id.fingerprint });
    if (id.eventId)
        correlationRows.push({ label: 'Event ID', value: id.eventId });
    if (id.extraRows && id.extraRows.length > 0)
        correlationRows.push(...id.extraRows);
    const actions = actionGroup([
        { url: input.traceUrl, label: 'Analyze Trace' },
        { url: input.requestUrl, label: 'View Request' },
        { url: input.alertUrl, label: 'View Alert' },
        { url: input.acknowledgeUrl, label: 'Acknowledge' },
        { url: input.silenceUrl, label: 'Silence' },
    ]);
    const body = stack([
        input.summary ? p(esc(input.summary)) : '',
        input.insight ? aiInsight(input.insight) : '',
        input.runbook ? callout('neutral', esc(input.runbook), 'First response') : '',
        actions.html,
        section('Request', dataTable(requestRows)),
        section('Incident', dataTable(incidentRows)),
        section('Correlation', dataTable(correlationRows)),
    ], 24);
    const m = input.measurement;
    return {
        subject: alertSubject('firing', severity, id.ruleName, input),
        html: renderLayout({
            appName: input.appName,
            title: id.ruleName,
            context: scopeContext(input),
            status: verdict(stateLabel('Firing', severity), tone, id.startedAt),
            preheader: m
                ? `${stripControl(m.label)} ${stripControl(m.value)} exceeded ${stripControl(m.threshold)}${scopeSuffix(input)}.`
                : `${stripControl(id.ruleName)} is firing${scopeSuffix(input)}.`,
            hero: m ? measurementHero(m, tone) : undefined,
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody(`ALERT FIRING — ${severity.toUpperCase()}`, id.ruleName, input.summary, m ? `${m.label}: ${m.value} (threshold ${m.threshold}${m.window ? `, ${m.window}` : ''})` : '', insightText(input.insight), input.runbook ? `First response\n${input.runbook}` : '', textBlock('Actions', actions.text), textSection('Request', requestRows), textSection('Incident', incidentRows), textSection('Correlation', correlationRows), id.startedAt ? `Started ${id.startedAt}` : ''),
    };
}
/**
 * Recovery notice. Always sent when a firing alert clears.
 * Green here is the truth channel doing its job: a verdict, not decoration.
 */
export function alertResolvedTemplate(input) {
    const id = input.identity;
    const cells = [];
    if (input.recoveredValue)
        cells.push({ label: 'Recovered to', value: input.recoveredValue, tone: 'success' });
    if (input.duration)
        cells.push({ label: 'Firing for', value: input.duration });
    const resolutionRows = [];
    if (input.resolvedBy)
        resolutionRows.push({ label: 'Resolved by', value: input.resolvedBy, sans: true });
    if (id.startedAt)
        resolutionRows.push({ label: 'Started', value: id.startedAt });
    if (input.reason)
        resolutionRows.push({ label: 'Reason', value: input.reason, sans: true });
    const incidentRows = [];
    const route = routeValue(id.endpoint, id.method);
    if (route)
        incidentRows.push({ label: 'Route', value: route });
    if (id.service)
        incidentRows.push({ label: 'Service', value: id.service });
    if (input.projectName)
        incidentRows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.environment)
        incidentRows.push({ label: 'Environment', value: input.environment });
    if (id.traceId)
        incidentRows.push({ label: 'Trace ID', value: id.traceId });
    if (id.fingerprint)
        incidentRows.push({ label: 'Fingerprint', value: id.fingerprint });
    const actions = actionGroup([{ url: input.alertUrl, label: 'View Incident Timeline' }]);
    const lead = `This alert has cleared${input.duration ? ` after ${stripControl(input.duration)}` : ''}. All monitored metrics returned to normal thresholds.`;
    const body = stack([
        p(esc(lead)),
        input.insight ? aiInsight(input.insight) : '',
        actions.html,
        section('Resolution', dataTable(resolutionRows)),
        section('Incident', dataTable(incidentRows)),
    ], 24);
    return {
        subject: alertSubject('resolved', null, id.ruleName, input),
        html: renderLayout({
            appName: input.appName,
            title: id.ruleName,
            context: scopeContext(input),
            status: verdict('Resolved', 'success', input.resolvedAt),
            preheader: `${stripControl(id.ruleName)} cleared${input.duration ? ` after ${stripControl(input.duration)}` : ''}${scopeSuffix(input)}.`,
            hero: cells.length > 0 ? readout(cells) : undefined,
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody('ALERT RESOLVED', id.ruleName, lead, input.recoveredValue ? `Recovered to ${input.recoveredValue}` : '', insightText(input.insight), textBlock('Actions', actions.text), textSection('Resolution', [
            ...(input.resolvedAt ? [{ label: 'Resolved at', value: input.resolvedAt }] : []),
            ...resolutionRows,
        ]), textSection('Incident', incidentRows)),
    };
}
/**
 * Acknowledgement notice — tells the rest of the rotation the alert is owned.
 */
export function alertAcknowledgedTemplate(input) {
    const id = input.identity;
    const rows = [{ label: 'Owner', value: input.acknowledgedBy, sans: true }];
    if (input.expiresAt)
        rows.push({ label: 'Ack expires', value: input.expiresAt, tone: 'warning' });
    if (input.projectName)
        rows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.environment)
        rows.push({ label: 'Environment', value: input.environment });
    if (id.fingerprint)
        rows.push({ label: 'Fingerprint', value: id.fingerprint });
    const resumes = input.expiresAt
        ? `If the alert is still firing at ${stripControl(input.expiresAt)}, the escalation policy resumes automatically.`
        : '';
    const actions = actionGroup([{ url: input.alertUrl, label: 'View Alert' }]);
    const body = stack([
        p(`${strong(input.acknowledgedBy)} has taken ownership of this alert. Escalation is paused.`),
        input.comment ? callout('neutral', esc(input.comment), 'Responder note') : '',
        actions.html,
        section('Ownership', stack([dataTable(rows), resumes ? note(esc(resumes)) : ''], 12)),
    ], 24);
    return {
        subject: alertSubject('acknowledged', null, id.ruleName, input),
        html: renderLayout({
            appName: input.appName,
            title: id.ruleName,
            context: scopeContext(input),
            status: verdict('Acknowledged', 'info', input.acknowledgedAt),
            preheader: `${stripControl(input.acknowledgedBy)} is on it — escalation is paused.`,
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody('ALERT ACKNOWLEDGED', id.ruleName, `${input.acknowledgedBy} has taken ownership of this alert. Escalation is paused.`, input.comment ? `Responder note\n${input.comment}` : '', textBlock('Actions', actions.text), textSection('Ownership', [
            ...(input.acknowledgedAt ? [{ label: 'Acknowledged at', value: input.acknowledgedAt }] : []),
            ...rows,
        ]), resumes),
    };
}
/**
 * Escalation notice — an alert went unanswered and the policy advanced.
 *
 * The readout shows how far the policy has advanced, and the step track draws
 * it: taken steps fill red, the steps still to come wait on the track.
 */
export function alertEscalatedTemplate(input) {
    const id = input.identity;
    const step = input.totalSteps
        ? `Step ${input.stepNumber} of ${input.totalSteps}`
        : `Step ${input.stepNumber}`;
    const cells = [
        {
            label: 'Escalation step',
            value: input.totalSteps ? `${input.stepNumber} of ${input.totalSteps}` : String(input.stepNumber),
            tone: 'danger',
        },
    ];
    if (input.firingFor)
        cells.push({ label: 'Unacknowledged for', value: input.firingFor });
    const track = input.totalSteps
        ? stepTrack({ current: input.stepNumber, total: input.totalSteps, tone: 'danger' })
        : '';
    const policyRows = [{ label: 'Policy', value: input.policyName, sans: true }];
    if (input.trigger)
        policyRows.push({ label: 'Trigger', value: input.trigger, sans: true });
    if (input.notifying)
        policyRows.push({ label: 'Notifying', value: input.notifying, sans: true });
    const targetRows = [];
    const route = routeValue(id.endpoint, id.method);
    if (route)
        targetRows.push({ label: 'Route', value: route });
    if (present(id.statusCode)) {
        targetRows.push({ label: 'HTTP status', value: String(id.statusCode), tone: httpTone(id.statusCode) });
    }
    if (id.duration)
        targetRows.push({ label: 'Time taken', value: id.duration });
    if (id.service)
        targetRows.push({ label: 'Service', value: id.service });
    if (input.projectName)
        targetRows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.environment)
        targetRows.push({ label: 'Environment', value: input.environment });
    if (id.traceId)
        targetRows.push({ label: 'Trace ID', value: id.traceId });
    if (id.fingerprint)
        targetRows.push({ label: 'Fingerprint', value: id.fingerprint });
    const actions = actionGroup([
        { url: input.acknowledgeUrl, label: 'Take Ownership' },
        { url: input.alertUrl, label: 'View Alert' },
        { url: input.silenceUrl, label: 'Silence' },
    ]);
    const body = stack([
        p(`This alert has not been acknowledged, so ${strong(input.policyName)} advanced to ${strong(step)} and widened the notification.`),
        actions.html,
        callout('neutral', 'Acknowledging stops further escalation. Silencing suppresses notifications without resolving the underlying condition &mdash; prefer acknowledgement while you investigate.', 'How to stop escalation'),
        section('Escalation', dataTable(policyRows)),
        section('Target', dataTable(targetRows)),
    ], 24);
    return {
        subject: alertSubject(`escalated s${input.stepNumber}`, id.severity, id.ruleName, input),
        html: renderLayout({
            appName: input.appName,
            title: id.ruleName,
            context: scopeContext(input),
            status: verdict(stateLabel('Escalated', id.severity), 'danger', id.startedAt),
            preheader: `Unacknowledged${input.firingFor ? ` for ${stripControl(input.firingFor)}` : ''} — ${stripControl(input.policyName)} escalated to ${step.toLowerCase()}.`,
            hero: readout(cells, { after: track }),
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody(`ALERT ESCALATED — ${step.toUpperCase()}`, id.ruleName, `This alert was not acknowledged; ${input.policyName} advanced to ${step.toLowerCase()}.`, input.firingFor ? `Unacknowledged for ${input.firingFor}.` : '', textBlock('Actions', actions.text), 'Acknowledging stops further escalation.', textSection('Escalation', [{ label: 'Severity', value: cap(id.severity) }, ...policyRows]), textSection('Target', targetRows)),
    };
}
/**
 * Silence-created notice. The readout states the size of the coverage gap:
 * how long, and how many rules it swallows.
 */
export function alertSilencedTemplate(input) {
    const cells = [];
    if (input.duration)
        cells.push({ label: 'Duration', value: input.duration });
    if (typeof input.matchedRules === 'number') {
        cells.push({ label: 'Rules matched', value: String(input.matchedRules), tone: 'warning' });
    }
    const rows = [
        { label: 'Target', value: input.target },
        { label: 'Silenced by', value: input.silencedBy, sans: true },
    ];
    if (input.reason)
        rows.push({ label: 'Reason', value: input.reason, sans: true });
    if (input.projectName)
        rows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.environment)
        rows.push({ label: 'Environment', value: input.environment });
    const actions = actionGroup([{ url: input.silenceUrl, label: 'Manage Silence' }]);
    const body = stack([
        p(`Notifications matching ${code(input.target)} are suppressed until ${esc(input.expiresAt)}. Rules keep evaluating and events keep recording &mdash; only the notifications stop.`),
        callout('warning', 'Anything this matcher covers will not page anyone while the silence is active. Remove it as soon as the maintenance or noisy deploy that justified it is over.', 'Coverage gap warning'),
        actions.html,
        section('Silence', dataTable(rows)),
    ], 24);
    return {
        subject: alertSubject('silenced', null, input.target, input),
        html: renderLayout({
            appName: input.appName,
            title: 'Alerts silenced',
            context: scopeContext(input),
            status: verdict('Silenced', 'warning', `Until ${stripControl(input.expiresAt)}`),
            preheader: `${stripControl(input.target)} will not notify anyone until ${stripControl(input.expiresAt)}.`,
            hero: cells.length > 0 ? readout(cells) : undefined,
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody('ALERTS SILENCED', `Notifications matching ${input.target} are suppressed until ${input.expiresAt}.`, textSection('Silence', [
            ...rows,
            { label: 'Expires at', value: input.expiresAt },
            ...cells.map((c) => ({ label: c.label, value: c.value })),
        ]), textBlock('Actions', actions.text), 'Rules keep evaluating; only notifications stop.'),
    };
}
/**
 * Periodic roll-up.
 *
 * The antidote to per-event noise: batch low-severity alerts into one scannable
 * digest so the real-time channel stays trustworthy for things that actually
 * need waking someone up. Counts read as a readout band; a zero stays muted,
 * because colour on a zero is decoration, not a verdict.
 */
export function alertDigestTemplate(input) {
    const items = input.entries.map((entry) => ({
        severityLabel: entry.severity,
        tone: severityTone(entry.severity),
        mark: severityGlyph(entry.severity),
        title: entry.ruleName,
        meta: entry.meta,
    }));
    const shown = input.entries.length;
    const total = input.totalCount ?? shown;
    const truncated = total > shown;
    const { firing, resolved, acknowledged } = input.counts;
    const quiet = firing === 0 && shown === 0;
    const where = scopeLabel(input) || 'your organization';
    const count = (labelText, n, tone) => n > 0
        ? { label: labelText, value: n.toLocaleString('en-US'), tone }
        : { label: labelText, value: '0', muted: true };
    const actions = actionGroup([{ url: input.feedUrl, label: 'Open alert feed' }]);
    const body = stack([
        p(`Alert activity across ${esc(where)} for the ${esc(input.period)}.`),
        quiet ? p('Nothing fired in this period. All monitored rules stayed inside their thresholds.') : '',
        section(truncated ? `Top ${shown} of ${total} alerts` : `${shown} alert${shown === 1 ? '' : 's'}`, digestList(items)),
        input.insight ? aiInsight(input.insight) : '',
        actions.html,
    ], 24);
    return {
        subject: `[DIGEST] ${total} alert${total === 1 ? '' : 's'} · ${stripControl(input.period)}${scopeLabel(input) ? ` — ${scopeLabel(input)}` : ''}`,
        html: renderLayout({
            appName: input.appName,
            title: `Alert digest · ${input.period}`,
            context: scopeContext(input),
            status: firing > 0 ? verdict(`${firing.toLocaleString('en-US')} firing`, 'warning') : verdict('All clear', 'success'),
            preheader: `${firing} firing, ${resolved} resolved, ${acknowledged} acknowledged in the ${stripControl(input.period)}.`,
            hero: readout([
                count('Firing', firing, 'warning'),
                count('Resolved', resolved, 'success'),
                count('Acknowledged', acknowledged, 'info'),
            ]),
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody(`ALERT DIGEST — ${input.period.toUpperCase()}`, textRows([
            { label: 'Firing', value: String(firing) },
            { label: 'Resolved', value: String(resolved) },
            { label: 'Acknowledged', value: String(acknowledged) },
        ]), quiet ? 'Nothing fired in this period. All monitored rules stayed inside their thresholds.' : '', input.entries
            .map((e) => `${e.severity.toUpperCase().padEnd(9)} ${e.ruleName} — ${e.meta}`)
            .join('\n'), truncated ? `Showing ${shown} of ${total} alerts.` : '', insightText(input.insight), textBlock('Actions', actions.text)),
    };
}
/**
 * AI anomaly notice.
 *
 * The one template where cyan is the dominant channel, because the entire
 * message is model output — there is no threshold, only inference. Baseline and
 * deviation sit beside the observed value, and the meter draws the distance
 * from the baseline, so the reader can judge the claim instead of taking it on
 * trust.
 */
export function anomalyDetectedTemplate(input) {
    const hero = input.observed && input.baseline
        ? metricCompare({
            // Short labels keep the three values on one baseline; the metric
            // name and window are stated in the facts below.
            label: 'Observed',
            value: input.observed,
            threshold: input.baseline,
            thresholdLabel: 'Baseline',
            tone: 'ai',
            extra: input.deviation ? [{ label: 'Deviation', value: input.deviation, tone: 'ai' }] : undefined,
        })
        : undefined;
    // Anything the readout already states is not repeated in the facts.
    const rows = [];
    if (input.metric)
        rows.push({ label: 'Metric', value: input.metric, sans: true });
    if (!hero && input.observed)
        rows.push({ label: 'Observed', value: input.observed });
    if (!hero && input.baseline)
        rows.push({ label: 'Baseline', value: input.baseline });
    if (!hero && input.deviation)
        rows.push({ label: 'Deviation', value: input.deviation, tone: 'ai' });
    if (input.window)
        rows.push({ label: 'Window', value: input.window });
    if (input.projectName)
        rows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.environment)
        rows.push({ label: 'Environment', value: input.environment });
    const insight = typeof input.confidence === 'number'
        ? { text: input.explanation, confidence: input.confidence }
        : { text: input.explanation };
    const reading = 'This is a statistical detection, not a threshold breach — no rule fired. Treat it as a lead to investigate rather than a confirmed fault.';
    const actions = actionGroup([{ url: input.alertUrl, label: 'Investigate Anomaly' }]);
    const body = stack([
        stack([aiInsight(insight), note(esc(reading))], 12),
        input.suggestedAction ? callout('ai', esc(input.suggestedAction), 'Suggested next step') : '',
        actions.html,
        section('Context', dataTable(rows)),
    ], 24);
    return {
        subject: `[ANOMALY] ${stripControl(input.title)}${scopeLabel(input) ? ` — ${scopeLabel(input)}` : ''}`,
        html: renderLayout({
            appName: input.appName,
            title: input.title,
            context: scopeContext(input),
            status: verdict('Anomaly detected', 'ai', input.detectedAt),
            preheader: input.deviation
                ? `${stripControl(input.metric ?? 'A metric')} is ${stripControl(input.deviation)} from its learned baseline.`
                : `A model flagged unusual behaviour${scopeSuffix(input)}.`,
            hero,
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody('ANOMALY DETECTED (AI)', input.title, insightText(insight), input.observed && input.baseline
            ? `${input.metric ?? 'Observed'}: ${input.observed} (baseline ${input.baseline}${input.deviation ? `, ${input.deviation}` : ''})`
            : '', reading, input.suggestedAction ? `Suggested next step\n${input.suggestedAction}` : '', textBlock('Actions', actions.text), textSection('Context', [
            ...rows,
            ...(input.detectedAt ? [{ label: 'Detected', value: input.detectedAt }] : []),
        ])),
    };
}
/**
 * Latency threshold breach — developer-focused performance triage.
 */
export function latencyAlertTemplate(input) {
    const severity = input.severity ?? 'warning';
    const tone = severityTone(severity);
    const pct = input.percentile.toUpperCase();
    const ruleName = input.ruleName || `${input.percentile} latency${input.endpoint ? ` · ${stripControl(input.endpoint)}` : ''}`;
    const performanceRows = [];
    if (input.aboveThreshold)
        performanceRows.push({ label: 'Above threshold', value: input.aboveThreshold, tone });
    if (typeof input.sampleSize === 'number') {
        performanceRows.push({ label: 'Sample count', value: input.sampleSize.toLocaleString('en-US') });
    }
    const requestRows = [];
    const route = routeValue(input.endpoint, input.method);
    if (route)
        requestRows.push({ label: 'Route', value: route });
    else if (input.method)
        requestRows.push({ label: 'Method', value: String(input.method).toUpperCase() });
    if (present(input.statusCode)) {
        requestRows.push({ label: 'HTTP status', value: String(input.statusCode), tone: httpTone(input.statusCode) });
    }
    if (input.duration)
        requestRows.push({ label: 'Duration', value: input.duration });
    if (input.service)
        requestRows.push({ label: 'Service', value: input.service });
    if (input.release)
        requestRows.push({ label: 'Release', value: input.release });
    const correlationRows = [];
    if (input.requestId)
        correlationRows.push({ label: 'Request', value: input.requestId });
    const trace = input.tracePublicId || input.traceId;
    if (trace)
        correlationRows.push({ label: 'Trace', value: trace });
    const span = input.spanPublicId || input.spanId;
    if (span)
        correlationRows.push({ label: 'Span', value: span });
    if (input.clientIp)
        correlationRows.push({ label: 'Client IP', value: input.clientIp });
    if (input.extraRows && input.extraRows.length > 0)
        correlationRows.push(...input.extraRows);
    const incidentRows = [];
    if (input.ruleName)
        incidentRows.push({ label: 'Rule', value: input.ruleName, sans: true });
    if (input.projectName)
        incidentRows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.environment)
        incidentRows.push({ label: 'Environment', value: input.environment });
    const actions = actionGroup([
        { url: input.traceUrl, label: 'Analyze Trace' },
        { url: input.requestUrl, label: 'View Request' },
        { url: input.alertUrl, label: 'View Alert' },
        { url: input.acknowledgeUrl, label: 'Acknowledge' },
        { url: input.silenceUrl, label: 'Silence' },
    ]);
    const contributors = input.topContributors ?? [];
    const body = stack([
        p(`${esc(pct)} response time is above the configured threshold${input.endpoint ? ` on ${code(input.endpoint)}` : ''}.`),
        input.insight ? aiInsight(input.insight) : '',
        actions.html,
        section('Slowest operations', lines(contributors)),
        section('Performance', dataTable(performanceRows)),
        section('Request', dataTable(requestRows)),
        section('Correlation', dataTable(correlationRows)),
        section('Incident', dataTable(incidentRows)),
    ], 24);
    return {
        subject: alertSubject('firing', severity, ruleName, input),
        html: renderLayout({
            appName: input.appName,
            title: `${pct} latency above threshold`,
            context: scopeContext(input),
            status: verdict(stateLabel('Firing', severity), tone, input.startedAt),
            preheader: `${stripControl(input.percentile)} is ${stripControl(input.observed)} against a ${stripControl(input.threshold)} threshold${input.endpoint ? ` on ${stripControl(input.endpoint)}` : ''}.`,
            hero: metricCompare({
                label: input.window ? `${pct} · ${input.window}` : `${pct} latency`,
                value: input.observed,
                threshold: input.threshold,
                tone,
            }),
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody(`LATENCY ALERT — ${severity.toUpperCase()}`, `${pct} is ${input.observed} (threshold ${input.threshold})${input.window ? ` over ${input.window}` : ''}.`, insightText(input.insight), textBlock('Actions', actions.text), textBlock('Slowest operations', contributors.join('\n')), textSection('Performance', performanceRows), textSection('Request', requestRows), textSection('Correlation', correlationRows), textSection('Incident', incidentRows), input.startedAt ? `Started ${input.startedAt}` : ''),
    };
}
/**
 * Developer-focused error alert.
 *
 * The readout band reads like the top of a stack trace — the exception type in
 * the verdict colour, the message, and the `at fn (file:line:col)` frame — so
 * the reader knows what broke and where before any table.
 */
export function errorAlertTemplate(input) {
    const severity = input.severity ?? 'error';
    const tone = severityTone(severity);
    const ruleName = input.ruleName || 'Unhandled Exception';
    const errorTitle = input.errorName || 'Error';
    const errorRows = [];
    if (input.errorId)
        errorRows.push({ label: 'Error ID', value: input.errorId });
    if (input.fingerprint)
        errorRows.push({ label: 'Fingerprint', value: input.fingerprint });
    if (input.handled !== undefined) {
        const handled = typeof input.handled === 'boolean' ? (input.handled ? 'Yes' : 'No') : String(input.handled);
        errorRows.push({ label: 'Handled', value: handled });
    }
    if (input.mechanism)
        errorRows.push({ label: 'Mechanism', value: input.mechanism });
    const requestRows = [];
    const route = routeValue(input.endpoint, input.method);
    if (route)
        requestRows.push({ label: 'Route', value: route });
    else if (input.method)
        requestRows.push({ label: 'Method', value: String(input.method).toUpperCase() });
    if (present(input.statusCode)) {
        requestRows.push({ label: 'HTTP status', value: String(input.statusCode), tone: httpTone(input.statusCode) });
    }
    if (input.requestId)
        requestRows.push({ label: 'Request ID', value: input.requestId });
    const impactRows = [];
    if (typeof input.occurrences === 'number') {
        impactRows.push({ label: 'Occurrences', value: input.occurrences.toLocaleString('en-US') });
    }
    if (input.firstSeenAt)
        impactRows.push({ label: 'First seen', value: input.firstSeenAt });
    if (input.lastSeenAt)
        impactRows.push({ label: 'Last seen', value: input.lastSeenAt });
    const runtimeRows = [];
    if (input.service)
        runtimeRows.push({ label: 'Service', value: input.service });
    if (input.environment)
        runtimeRows.push({ label: 'Environment', value: input.environment });
    if (input.release)
        runtimeRows.push({ label: 'Release', value: input.release });
    if (input.framework)
        runtimeRows.push({ label: 'Framework', value: input.framework });
    const correlationRows = [];
    const trace = input.tracePublicId || input.traceId;
    if (trace)
        correlationRows.push({ label: 'Trace', value: trace });
    const span = input.spanPublicId || input.spanId;
    if (span)
        correlationRows.push({ label: 'Span', value: span });
    if (input.clientIp)
        correlationRows.push({ label: 'Client IP', value: input.clientIp });
    if (input.extraRows && input.extraRows.length > 0)
        correlationRows.push(...input.extraRows);
    const actions = actionGroup([
        { url: input.traceUrl, label: 'Analyze Trace' },
        { url: input.errorUrl || input.eventUrl, label: 'View Error' },
        { url: input.alertUrl, label: 'View Alert' },
        { url: input.acknowledgeUrl, label: 'Acknowledge' },
        { url: input.silenceUrl, label: 'Silence' },
    ]);
    const body = stack([
        p(`An error event triggered alert rule ${strong(ruleName)}${input.endpoint ? ` on ${code(input.endpoint)}` : ''}.`),
        input.insight ? aiInsight(input.insight) : '',
        actions.html,
        input.sourceContext ? section('Source', codeBlock(input.sourceContext)) : '',
        section('Error', dataTable(errorRows)),
        section('Request', dataTable(requestRows)),
        section('Impact', dataTable(impactRows)),
        section('Runtime', dataTable(runtimeRows)),
        section('Trace', dataTable(correlationRows)),
    ], 24);
    const frameText = input.sourceFunction && input.sourceFrame
        ? `at ${input.sourceFunction} (${input.sourceFrame})`
        : input.sourceFrame
            ? `at ${input.sourceFrame}`
            : input.sourceFunction
                ? `at ${input.sourceFunction}`
                : '';
    return {
        subject: alertSubject('firing', severity, errorTitle !== 'Error' ? errorTitle : ruleName, input),
        html: renderLayout({
            appName: input.appName,
            title: errorTitle !== 'Error' ? `${errorTitle} detected` : 'Error detected',
            context: scopeContext(input),
            status: verdict(stateLabel('Firing', severity), tone, input.startedAt),
            preheader: `${stripControl(errorTitle)}: ${stripControl(input.errorMessage || ruleName)}${input.endpoint ? ` on ${stripControl(input.endpoint)}` : ''}.`,
            hero: exceptionBlock({
                type: errorTitle,
                message: input.errorMessage,
                frame: input.sourceFrame,
                fn: input.sourceFunction,
                tone,
            }),
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody(`ERROR ALERT — ${severity.toUpperCase()}`, `${ruleName}: ${input.errorMessage || errorTitle}`, `${errorTitle}${input.errorMessage ? `: ${input.errorMessage}` : ''}${frameText ? `\n    ${frameText}` : ''}`, insightText(input.insight), textBlock('Actions', actions.text), textBlock('Source', input.sourceContext ?? ''), textSection('Error', errorRows), textSection('Request', requestRows), textSection('Impact', impactRows), textSection('Runtime', runtimeRows), textSection('Trace', correlationRows)),
    };
}
/**
 * Error-rate spike. The rate carries the readout; the absolute count leads the
 * impact facts, because a rate alone hides whether this is 50% of 2 requests
 * or of 2 million.
 */
export function errorSpikeTemplate(input) {
    const severity = input.severity ?? 'error';
    const tone = severityTone(severity);
    const ruleName = `Error rate${input.endpoint ? ` · ${stripControl(input.endpoint)}` : ''}`;
    const impactRows = [];
    if (typeof input.errorCount === 'number' && typeof input.totalRequests === 'number') {
        impactRows.push({
            label: 'Failed / total',
            value: `${input.errorCount.toLocaleString('en-US')} / ${input.totalRequests.toLocaleString('en-US')}`,
            tone,
        });
    }
    else if (typeof input.errorCount === 'number') {
        impactRows.push({ label: 'Failed requests', value: input.errorCount.toLocaleString('en-US'), tone });
    }
    if (input.topStatusCode) {
        impactRows.push({ label: 'Top status', value: input.topStatusCode, tone: httpTone(input.topStatusCode) ?? tone });
    }
    if (input.topError)
        impactRows.push({ label: 'Top error', value: input.topError });
    const requestRows = [];
    const route = routeValue(input.endpoint, input.method);
    if (route)
        requestRows.push({ label: 'Route', value: route });
    else if (input.method)
        requestRows.push({ label: 'Method', value: String(input.method).toUpperCase() });
    if (input.service)
        requestRows.push({ label: 'Service', value: input.service });
    const correlationRows = [];
    if (input.traceId)
        correlationRows.push({ label: 'Trace ID', value: input.traceId });
    if (input.spanId)
        correlationRows.push({ label: 'Span ID', value: input.spanId });
    if (input.clientIp)
        correlationRows.push({ label: 'Client IP', value: input.clientIp });
    if (input.extraRows && input.extraRows.length > 0)
        correlationRows.push(...input.extraRows);
    const incidentRows = [];
    if (input.projectName)
        incidentRows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.environment)
        incidentRows.push({ label: 'Environment', value: input.environment });
    const actions = actionGroup([
        { url: input.traceUrl, label: 'Analyze Trace' },
        { url: input.requestUrl, label: 'View Requests' },
        { url: input.alertUrl, label: 'View Alert' },
        { url: input.acknowledgeUrl, label: 'Acknowledge' },
        { url: input.silenceUrl, label: 'Silence' },
    ]);
    const body = stack([
        p(`Requests are failing above the configured error-rate threshold${input.endpoint ? ` on ${code(input.endpoint)}` : ''}.`),
        input.insight ? aiInsight(input.insight) : '',
        actions.html,
        section('Impact', dataTable(impactRows)),
        section('Request', dataTable(requestRows)),
        section('Correlation', dataTable(correlationRows)),
        section('Incident', dataTable(incidentRows)),
    ], 24);
    return {
        subject: alertSubject('firing', severity, ruleName, input),
        html: renderLayout({
            appName: input.appName,
            title: 'Error rate above threshold',
            context: scopeContext(input),
            status: verdict(stateLabel('Firing', severity), tone, input.startedAt),
            preheader: `Error rate is ${stripControl(input.errorRate)} against a ${stripControl(input.threshold)} threshold${input.endpoint ? ` on ${stripControl(input.endpoint)}` : ''}.`,
            hero: metricCompare({
                label: input.window ? `Error rate · ${input.window}` : 'Error rate',
                value: input.errorRate,
                threshold: input.threshold,
                tone,
            }),
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody(`ERROR SPIKE — ${severity.toUpperCase()}`, `Error rate is ${input.errorRate} (threshold ${input.threshold})${input.window ? ` over ${input.window}` : ''}.`, insightText(input.insight), textBlock('Actions', actions.text), textSection('Impact', impactRows), textSection('Request', requestRows), textSection('Correlation', correlationRows), textSection('Incident', incidentRows), input.startedAt ? `Started ${input.startedAt}` : ''),
    };
}
const HEALTH_META = {
    down: { tone: 'danger', label: 'Down', state: 'down', severity: 'critical' },
    degraded: { tone: 'warning', label: 'Degraded', state: 'degraded', severity: 'warning' },
    recovered: { tone: 'success', label: 'Recovered', state: 'recovered', severity: null },
};
/**
 * Availability transition — a service went down, degraded, or came back.
 */
export function serviceHealthTemplate(input) {
    const meta = HEALTH_META[input.status];
    const recovered = input.status === 'recovered';
    const service = stripControl(input.serviceName);
    const cells = [];
    if (typeof input.failedChecks === 'number') {
        cells.push({ label: 'Failed checks', value: String(input.failedChecks), tone: meta.tone });
    }
    if (input.downtime)
        cells.push({ label: 'Downtime', value: input.downtime });
    if (input.availability)
        cells.push({ label: 'Availability', value: input.availability });
    const rows = [{ label: 'Service', value: input.serviceName }];
    if (input.detail)
        rows.push({ label: 'Observation', value: input.detail });
    if (input.region)
        rows.push({ label: 'Probe region', value: input.region });
    if (input.checkUrl)
        rows.push({ label: 'Check endpoint', value: input.checkUrl });
    if (input.projectName)
        rows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.environment)
        rows.push({ label: 'Environment', value: input.environment });
    const lead = recovered
        ? `${service} is responding normally again${input.downtime ? ` after ${stripControl(input.downtime)} of downtime` : ''}.`
        : input.status === 'degraded'
            ? `${service} is responding, but outside its healthy operating envelope.`
            : `${service} is not responding to automated health checks.`;
    const actions = recovered
        ? actionGroup([{ url: input.alertUrl, label: 'View Incident Timeline' }])
        : actionGroup([
            { url: input.alertUrl, label: 'View Service' },
            { url: input.acknowledgeUrl, label: 'Acknowledge' },
        ]);
    const body = stack([
        p(esc(lead)),
        input.insight ? aiInsight(input.insight) : '',
        actions.html,
        section('Health', dataTable(rows)),
    ], 24);
    return {
        subject: alertSubject(recovered ? 'recovered' : `service ${meta.state}`, meta.severity, input.serviceName, input),
        html: renderLayout({
            appName: input.appName,
            title: recovered ? `${input.serviceName} recovered` : `${input.serviceName} is ${meta.state}`,
            context: scopeContext(input),
            status: verdict(meta.label, meta.tone, input.observedAt),
            preheader: recovered
                ? `${service} is healthy again${input.downtime ? ` after ${stripControl(input.downtime)}` : ''}.`
                : `${service} is ${meta.state}${input.detail ? ` — ${stripControl(input.detail)}` : ''}.`,
            hero: cells.length > 0 ? readout(cells) : undefined,
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody(`SERVICE ${meta.label.toUpperCase()}`, lead, textSection('Health', [...cells.map((c) => ({ label: c.label, value: c.value })), ...rows]), insightText(input.insight), textBlock('Actions', actions.text), input.observedAt ? `Observed ${input.observedAt}` : ''),
    };
}
/**
 * Usage-quota warning. The meter shows consumption against the plan limit:
 * under the limit the fill carries the tone, past it only the overage does.
 */
export function quotaAlertTemplate(input) {
    const pct = Number.isFinite(input.percentUsed) ? Math.round(input.percentUsed) : 0;
    const exceeded = pct >= 100;
    const tone = exceeded ? 'danger' : pct >= 80 ? 'warning' : 'info';
    const resource = input.resource.toLowerCase();
    const rows = [];
    if (input.planName)
        rows.push({ label: 'Current plan', value: input.planName, sans: true });
    if (input.projectName)
        rows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.orgName)
        rows.push({ label: 'Organization', value: input.orgName, sans: true });
    const actions = actionGroup([
        { url: input.upgradeUrl, label: 'Increase limit' },
        { url: input.usageUrl, label: 'View usage' },
    ]);
    const body = stack([
        p(exceeded
            ? `Your ${strong(resource)} quota is fully consumed for this billing period.`
            : `Your ${strong(resource)} quota is ${strong(`${pct}%`)} consumed for this billing period.`),
        input.overagePolicy
            ? callout(exceeded ? 'danger' : 'warning', esc(input.overagePolicy), exceeded ? 'In effect now' : 'What happens at 100%')
            : '',
        actions.html,
        section('Plan', dataTable(rows)),
    ], 24);
    return {
        subject: `[QUOTA${exceeded ? ' · EXCEEDED' : ''}] ${stripControl(input.resource)} at ${pct}%${scopeLabel(input) ? ` — ${scopeLabel(input)}` : ''}`,
        html: renderLayout({
            appName: input.appName,
            title: exceeded ? `${input.resource} quota exceeded` : `${input.resource} quota at ${pct}%`,
            context: scopeContext(input),
            status: verdict(exceeded ? 'Quota exceeded' : `${pct}% used`, tone, input.resetsAt ? `Resets ${stripControl(input.resetsAt)}` : undefined),
            preheader: `${stripControl(input.used)} of ${stripControl(input.limit)} ${stripControl(resource)} used${input.resetsAt ? ` — resets ${stripControl(input.resetsAt)}` : ''}.`,
            hero: metricCompare({
                label: input.resource,
                value: input.used,
                threshold: input.limit,
                thresholdLabel: 'Plan limit',
                tone,
                extra: [{ label: 'Utilization', value: `${pct}%`, tone }],
            }),
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody(`USAGE QUOTA ${exceeded ? 'EXCEEDED' : `AT ${pct}%`}`, `${input.resource}: ${input.used} of ${input.limit} used (${pct}%).`, input.overagePolicy ? `${exceeded ? 'In effect now' : 'What happens at 100%'}\n${input.overagePolicy}` : '', textBlock('Actions', actions.text), textSection('Plan', [
            ...rows,
            ...(input.resetsAt ? [{ label: 'Billing resets', value: input.resetsAt }] : []),
        ])),
    };
}
/**
 * Meta-alert: the alerting system itself could not deliver. The connector's
 * own response is shown verbatim in a code well, because it is usually the
 * whole diagnosis ("invalid_auth", "channel_not_found").
 */
export function deliveryFailureTemplate(input) {
    const plural = input.failedCount === 1 ? '' : 's';
    const cells = [
        { label: 'Failed deliveries', value: input.failedCount.toLocaleString('en-US'), tone: 'danger' },
    ];
    if (typeof input.attempts === 'number')
        cells.push({ label: 'Attempts', value: String(input.attempts) });
    if (typeof input.statusCode === 'number') {
        cells.push({ label: 'Last HTTP status', value: String(input.statusCode), tone: httpTone(input.statusCode) });
    }
    const rows = [{ label: 'Connector', value: input.connectorName, sans: true }];
    if (input.connectorType)
        rows.push({ label: 'Channel type', value: input.connectorType });
    if (input.firstFailedAt)
        rows.push({ label: 'First failure', value: input.firstFailedAt });
    if (input.deadLettered !== undefined) {
        rows.push({
            label: 'Dead-lettered',
            value: input.deadLettered ? 'Yes — retained for replay' : 'No',
            tone: input.deadLettered ? 'warning' : undefined,
            sans: true,
        });
    }
    if (input.orgName)
        rows.push({ label: 'Organization', value: input.orgName, sans: true });
    const actions = actionGroup([{ url: input.connectorUrl, label: 'Manage Connector Settings' }]);
    const body = stack([
        p(`${esc(input.appName)} could not deliver ${strong(String(input.failedCount))} alert notification${plural} through ${strong(input.connectorName)}. Those alerts fired correctly &mdash; but notifications failed to dispatch.`),
        input.lastError ? section('Connector response', codeBlock(input.lastError)) : '',
        callout('danger', 'Until this connector is repaired, alerts routed through it are invisible to whoever depends on it. Verify the webhook URL or credential and send a test notification to confirm delivery.', 'Silent-failure risk'),
        actions.html,
        section('Connector', dataTable(rows)),
    ], 24);
    return {
        subject: `[DELIVERY FAILED] ${stripControl(input.connectorName)} — ${input.failedCount} notification${plural}`,
        html: renderLayout({
            appName: input.appName,
            title: 'Alert delivery is failing',
            context: scopeContext(input),
            status: verdict('Delivery failing', 'danger', input.lastFailedAt),
            preheader: `${input.failedCount} notification${plural} could not be delivered through ${stripControl(input.connectorName)}.`,
            hero: readout(cells),
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody('ALERT DELIVERY FAILING', `${input.appName} could not deliver ${input.failedCount} alert notification${plural} through ${input.connectorName}.`, textBlock('Connector response', input.lastError ?? ''), textBlock('Actions', actions.text), textSection('Connector', [
            ...cells.map((c) => ({ label: c.label, value: c.value })),
            ...rows,
            ...(input.lastFailedAt ? [{ label: 'Last failure', value: input.lastFailedAt }] : []),
        ])),
    };
}
const RULE_ACTION_META = {
    created: { tone: 'success', verb: 'created' },
    updated: { tone: 'info', verb: 'updated' },
    disabled: { tone: 'warning', verb: 'disabled' },
    deleted: { tone: 'danger', verb: 'deleted' },
};
const COVERAGE_GAP = 'While this rule is disabled, nothing it watches will alert anyone. That is a gap in coverage, not a reduction in noise — re-enable it when the reason for disabling it has passed.';
const COVERAGE_REMOVED = 'This rule no longer exists. Whatever condition it watched will not be detected again unless an equivalent rule is created.';
/**
 * Alert-rule audit notice. Field-level changes are listed one per hairline row
 * in mono, so `Threshold: 800 ms → 1500 ms` reads like a diff.
 */
export function ruleChangedTemplate(input) {
    const meta = RULE_ACTION_META[input.action];
    const changes = input.changes ?? [];
    const rows = [{ label: 'Changed by', value: input.changedBy, sans: true }];
    if (input.projectName)
        rows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.environment)
        rows.push({ label: 'Environment', value: input.environment });
    const actions = actionGroup([{ url: input.ruleUrl, label: 'View Rule Configuration' }]);
    const body = stack([
        p(`${strong(input.changedBy)} ${esc(meta.verb)} this alert rule.`),
        input.action === 'disabled'
            ? callout('warning', esc(COVERAGE_GAP), 'Coverage gap warning')
            : input.action === 'deleted'
                ? callout('danger', esc(COVERAGE_REMOVED), 'Coverage removed')
                : '',
        section('Changes', lines(changes)),
        actions.html,
        section('Audit trail', dataTable(rows)),
    ], 24);
    return {
        subject: `[RULE ${meta.verb.toUpperCase()}] ${stripControl(input.ruleName)}${scopeLabel(input) ? ` — ${scopeLabel(input)}` : ''}`,
        html: renderLayout({
            appName: input.appName,
            title: input.ruleName,
            context: scopeContext(input),
            status: verdict(`Rule ${meta.verb}`, meta.tone, input.changedAt),
            preheader: `${stripControl(input.changedBy)} ${meta.verb} ${stripControl(input.ruleName)}.`,
            body,
            footer: 'alert',
            footerLink: footerLinkFor(input),
            closing: null,
        }),
        text: textBody(`ALERT RULE ${meta.verb.toUpperCase()}`, `${input.changedBy} ${meta.verb} the alert rule "${input.ruleName}".`, input.action === 'disabled' ? COVERAGE_GAP : input.action === 'deleted' ? COVERAGE_REMOVED : '', textBlock('Changes', changes.map((c) => `  - ${c}`).join('\n')), textBlock('Actions', actions.text), textSection('Audit trail', [
            ...rows,
            ...(input.changedAt ? [{ label: 'Timestamp', value: input.changedAt }] : []),
        ])),
    };
}
/* ── end of alert templates ── */
//# sourceMappingURL=alert-templates.js.map