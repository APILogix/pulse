/**
 * Renders every email template to disk for visual review.
 *
 * Email design cannot be verified by reading code — the only honest check is
 * looking at the rendered HTML, and then at the same HTML in a real client.
 * This script produces both: one file per template variant, plus a gallery that
 * frames them side by side.
 *
 * Usage:
 *   npx tsx scripts/preview-emails.ts
 *   npx tsx scripts/preview-emails.ts --out reports/email-previews
 *
 * Then open `reports/email-previews/index.html`.
 *
 * The generated `.eml` files can be dragged straight into Outlook, Apple Mail
 * or Thunderbird to check the real rendering path — including the VML buttons
 * and the `[if mso]` branches, which a browser will never exercise.
 *
 * No network, no database, no SMTP: the templates are pure functions, so this
 * runs anywhere.
 */
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import {
  accountDeletionConfirmTemplate,
  accountUnlockTemplate,
  alertAcknowledgedTemplate,
  alertDigestTemplate,
  alertEscalatedTemplate,
  alertFiringTemplate,
  alertResolvedTemplate,
  alertSilencedTemplate,
  anomalyDetectedTemplate,
  apiKeyCreatedTemplate,
  deliveryFailureTemplate,
  emailVerificationTemplate,
  errorSpikeTemplate,
  latencyAlertTemplate,
  mfaCodeTemplate,
  mfaDisableConfirmTemplate,
  mfaStatusTemplate,
  newSignInTemplate,
  orgInvitationTemplate,
  passwordChangedTemplate,
  passwordResetTemplate,
  quotaAlertTemplate,
  ruleChangedTemplate,
  serviceHealthTemplate,
  type EmailTemplate,
} from '../src/shared/email/index.js';

/* ── Sample data ──────────────────────────────────────────────────────── */

const APP = 'Pulsiv';
const USER = 'Ada';
const BASE = 'https://app.pulsiv.io';

const CONTEXT = {
  requestedAt: '1 Aug 2026, 01:12 UTC',
  device: 'Chrome 141 on macOS',
  ipAddress: '203.0.113.42',
  location: 'Bengaluru, IN',
};

const SCOPE = {
  appName: APP,
  orgName: 'Northwind Labs',
  projectName: 'checkout-api',
  environment: 'production',
  alertUrl: `${BASE}/alerts/evt_01JQ8Z3K5R`,
  acknowledgeUrl: `${BASE}/alerts/evt_01JQ8Z3K5R/ack`,
  silenceUrl: `${BASE}/alerts/silences/new?fingerprint=a91f0c`,
  preferencesUrl: `${BASE}/settings/notifications`,
};

const IDENTITY = {
  ruleName: 'Checkout p95 latency above 800 ms',
  severity: 'critical' as const,
  source: 'telemetry',
  fingerprint: 'a91f0c4e7b2d8815',
  eventId: 'evt_01JQ8Z3K5R',
  startedAt: '1 Aug 2026, 01:08 UTC',
  occurrences: 14,
};

/* ── Template catalogue ───────────────────────────────────────────────── */

interface PreviewEntry {
  group: 'Authentication & account' | 'Alerts & monitoring';
  slug: string;
  name: string;
  template: EmailTemplate;
}

function catalogue(): PreviewEntry[] {
  const auth = (slug: string, name: string, template: EmailTemplate): PreviewEntry => ({
    group: 'Authentication & account',
    slug,
    name,
    template,
  });
  const alert = (slug: string, name: string, template: EmailTemplate): PreviewEntry => ({
    group: 'Alerts & monitoring',
    slug,
    name,
    template,
  });

  return [
    /* ── Authentication & account ── */
    auth(
      'password-reset',
      'Password reset',
      passwordResetTemplate({
        appName: APP,
        userName: USER,
        actionUrl: `${BASE}/reset-password?token=8f3a91c07e5b4d2a`,
        expiresInMinutes: 30,
        context: CONTEXT,
      }),
    ),
    auth(
      'email-verification',
      'Email verification',
      emailVerificationTemplate({
        appName: APP,
        userName: USER,
        actionUrl: `${BASE}/verify-email?token=1c9d4e77af02b3e5`,
        expiresInMinutes: 60,
      }),
    ),
    auth(
      'mfa-code-login',
      'MFA code — sign-in',
      mfaCodeTemplate({
        appName: APP,
        userName: USER,
        code: '481902',
        expiresInMinutes: 10,
        purpose: 'login',
        deviceName: 'Chrome on macOS',
        context: CONTEXT,
      }),
    ),
    auth(
      'mfa-code-setup',
      'MFA code — setup',
      mfaCodeTemplate({
        appName: APP,
        userName: USER,
        code: '702415',
        expiresInMinutes: 10,
        purpose: 'setup',
      }),
    ),
    auth(
      'mfa-enabled',
      'MFA enabled',
      mfaStatusTemplate({ appName: APP, userName: USER, enabled: true, context: CONTEXT }),
    ),
    auth(
      'mfa-disabled',
      'MFA disabled',
      mfaStatusTemplate({ appName: APP, userName: USER, enabled: false, context: CONTEXT }),
    ),
    auth(
      'mfa-disable-confirm',
      'MFA disable confirmation',
      mfaDisableConfirmTemplate({
        appName: APP,
        userName: USER,
        actionUrl: `${BASE}/security/mfa/disable?token=b47c2e9081a6f3d5`,
        expiresInMinutes: 15,
        context: CONTEXT,
      }),
    ),
    auth(
      'account-unlock',
      'Account unlock',
      accountUnlockTemplate({
        appName: APP,
        userName: USER,
        actionUrl: `${BASE}/unlock?token=d92f10ba4c7e6835`,
        expiresInMinutes: 20,
        context: CONTEXT,
      }),
    ),
    auth(
      'account-deletion',
      'Account deletion confirmation',
      accountDeletionConfirmTemplate({
        appName: APP,
        userName: USER,
        actionUrl: `${BASE}/account/delete/confirm?token=e18a05cf37b29d64`,
        expiresInMinutes: 60,
        scheduledFor: '31 Aug 2026',
        context: CONTEXT,
      }),
    ),
    auth(
      'password-changed',
      'Password changed',
      passwordChangedTemplate({ appName: APP, userName: USER, context: CONTEXT }),
    ),
    auth(
      'new-sign-in',
      'New sign-in (new)',
      newSignInTemplate({
        appName: APP,
        userName: USER,
        context: CONTEXT,
        reviewUrl: `${BASE}/settings/sessions`,
      }),
    ),
    auth(
      'api-key-created',
      'API key created (new)',
      apiKeyCreatedTemplate({
        appName: APP,
        userName: USER,
        keyName: 'CI pipeline — ingest',
        keyPrefix: 'plsv_live_9f2c',
        projectName: 'checkout-api',
        scopes: 'ingest:write, telemetry:read',
        manageUrl: `${BASE}/settings/api-keys`,
        context: CONTEXT,
      }),
    ),
    auth(
      'org-invitation',
      'Organization invitation',
      orgInvitationTemplate({
        appName: APP,
        actionUrl: `${BASE}/accept-invite?token=77b0e4a1c2d93f68&new=1`,
        orgName: 'Northwind Labs',
        inviterName: 'Grace Hopper',
        roleLabel: 'Engineer',
        expiresInDays: 7,
        accountExists: false,
      }),
    ),

    /* ── Alerts & monitoring ── */
    alert(
      'alert-firing',
      'Alert firing',
      alertFiringTemplate({
        ...SCOPE,
        identity: IDENTITY,
        summary:
          'Checkout latency has been above its threshold for six consecutive evaluation windows. Payment confirmations are queueing behind the slowdown.',
        measurement: {
          label: 'p95 latency',
          value: '1,842 ms',
          threshold: '800 ms',
          window: 'last 5 minutes',
        },
        runbook: 'Check the payment-gateway connection pool first — saturation there has caused this signature twice before.',
        insight: {
          text: 'Latency began climbing four minutes after deploy 4f21a8c. The p99 curve matches the pattern of connection-pool exhaustion rather than a downstream provider slowdown.',
          confidence: 87,
        },
      }),
    ),
    alert(
      'alert-resolved',
      'Alert resolved',
      alertResolvedTemplate({
        ...SCOPE,
        identity: IDENTITY,
        duration: '18 minutes',
        resolvedBy: 'Auto-resolve',
        resolvedAt: '1 Aug 2026, 01:26 UTC',
        reason: 'Metric returned below threshold for 3 consecutive windows',
        recoveredValue: '412 ms',
      }),
    ),
    alert(
      'alert-acknowledged',
      'Alert acknowledged',
      alertAcknowledgedTemplate({
        ...SCOPE,
        identity: IDENTITY,
        acknowledgedBy: 'Grace Hopper',
        acknowledgedAt: '1 Aug 2026, 01:14 UTC',
        comment: 'Rolling back deploy 4f21a8c. Will confirm once p95 settles.',
        expiresAt: '1 Aug 2026, 02:14 UTC',
      }),
    ),
    alert(
      'alert-escalated',
      'Alert escalated',
      alertEscalatedTemplate({
        ...SCOPE,
        identity: IDENTITY,
        policyName: 'Payments on-call',
        stepNumber: 2,
        totalSteps: 3,
        trigger: 'No acknowledgement within 15 minutes',
        notifying: 'Platform leads, secondary on-call',
        firingFor: '17 minutes',
      }),
    ),
    alert(
      'alert-silenced',
      'Alerts silenced',
      alertSilencedTemplate({
        ...SCOPE,
        target: 'project=checkout-api, env=staging',
        silencedBy: 'Grace Hopper',
        expiresAt: '1 Aug 2026, 06:00 UTC',
        duration: '4 hours',
        reason: 'Planned load test',
        matchedRules: 9,
      }),
    ),
    alert(
      'alert-digest',
      'Alert digest',
      alertDigestTemplate({
        ...SCOPE,
        projectName: undefined,
        environment: undefined,
        period: 'last 24 hours',
        counts: { firing: 3, resolved: 11, acknowledged: 5 },
        totalCount: 19,
        feedUrl: `${BASE}/alerts`,
        entries: [
          {
            ruleName: 'Checkout p95 latency above 800 ms',
            severity: 'critical',
            meta: 'checkout-api · 14 occurrences · 01:08',
          },
          {
            ruleName: 'Error rate above 2%',
            severity: 'error',
            meta: 'auth-api · 6 occurrences · 22:41',
          },
          {
            ruleName: 'Ingestion lag above 60 s',
            severity: 'warning',
            meta: 'collector · 3 occurrences · 19:02',
          },
          {
            ruleName: 'Certificate expires within 14 days',
            severity: 'info',
            meta: 'edge-proxy · 1 occurrence · 08:15',
          },
        ],
        insight: {
          text: 'Two thirds of this period’s alerts trace back to the checkout-api deploy window between 00:50 and 01:10. Consider a canary stage for that service.',
          confidence: 74,
        },
      }),
    ),
    alert(
      'anomaly-detected',
      'Anomaly detected (AI)',
      anomalyDetectedTemplate({
        ...SCOPE,
        title: 'Unusual write volume on the events table',
        explanation:
          'Write throughput is 4.4× the 14-day baseline for this hour of the week, with no matching increase in request volume. The shape suggests a retry storm rather than genuine traffic growth.',
        confidence: 91,
        metric: 'Rows written / minute',
        observed: '182k',
        baseline: '41k',
        deviation: '+344%',
        window: 'last 30 minutes',
        detectedAt: '1 Aug 2026, 01:05 UTC',
        suggestedAction:
          'Inspect the ingestion client retry policy for exponential backoff. A fixed-interval retry on a 5xx would produce exactly this curve.',
      }),
    ),
    alert(
      'latency-alert',
      'Latency threshold',
      latencyAlertTemplate({
        ...SCOPE,
        percentile: 'p95',
        observed: '1,842 ms',
        threshold: '800 ms',
        window: 'last 5 minutes',
        endpoint: 'POST /v1/checkout/confirm',
        sampleSize: 8412,
        severity: 'error',
        startedAt: '1 Aug 2026, 01:08 UTC',
        topContributors: [
          'payment-gateway.charge — 1,204 ms avg',
          'inventory.reserve — 388 ms avg',
          'db.orders.insert — 141 ms avg',
        ],
      }),
    ),
    alert(
      'error-spike',
      'Error-rate spike',
      errorSpikeTemplate({
        ...SCOPE,
        errorRate: '12.4%',
        threshold: '2%',
        errorCount: 1043,
        totalRequests: 8412,
        window: 'last 5 minutes',
        topStatusCode: '503',
        topError: 'UpstreamTimeout: payment-gateway did not respond within 3000 ms',
        endpoint: 'POST /v1/checkout/confirm',
        severity: 'critical',
        startedAt: '1 Aug 2026, 01:09 UTC',
      }),
    ),
    alert(
      'service-down',
      'Service down',
      serviceHealthTemplate({
        ...SCOPE,
        serviceName: 'payment-gateway',
        status: 'down',
        detail: 'connection refused',
        checkUrl: 'https://gateway.internal/healthz',
        region: 'ap-south-1',
        failedChecks: 4,
        availability: '99.87%',
        observedAt: '1 Aug 2026, 01:07 UTC',
      }),
    ),
    alert(
      'service-degraded',
      'Service degraded',
      serviceHealthTemplate({
        ...SCOPE,
        serviceName: 'payment-gateway',
        status: 'degraded',
        detail: 'HTTP 200 but responding in 4.2 s (healthy envelope: under 1 s)',
        region: 'ap-south-1',
        availability: '99.87%',
        observedAt: '1 Aug 2026, 01:07 UTC',
      }),
    ),
    alert(
      'service-recovered',
      'Service recovered',
      serviceHealthTemplate({
        ...SCOPE,
        serviceName: 'payment-gateway',
        status: 'recovered',
        downtime: '11 minutes',
        availability: '99.85%',
        observedAt: '1 Aug 2026, 01:18 UTC',
      }),
    ),
    alert(
      'quota-warning',
      'Quota approaching limit',
      quotaAlertTemplate({
        ...SCOPE,
        projectName: undefined,
        resource: 'Events ingested',
        used: '8.6M',
        limit: '10M',
        percentUsed: 86,
        resetsAt: '1 Sep 2026',
        planName: 'Scale',
        overagePolicy:
          'At 100% new events are throttled rather than dropped, and overage is billed at $0.20 per 100k events.',
        upgradeUrl: `${BASE}/settings/billing/plans`,
        usageUrl: `${BASE}/settings/usage`,
      }),
    ),
    alert(
      'quota-exceeded',
      'Quota exceeded',
      quotaAlertTemplate({
        ...SCOPE,
        projectName: undefined,
        resource: 'Log volume',
        used: '52 GB',
        limit: '50 GB',
        percentUsed: 104,
        resetsAt: '1 Sep 2026',
        planName: 'Scale',
        overagePolicy: 'Log ingestion is throttled to 60% of normal rate until the quota resets or the plan is upgraded.',
        upgradeUrl: `${BASE}/settings/billing/plans`,
        usageUrl: `${BASE}/settings/usage`,
      }),
    ),
    alert(
      'delivery-failure',
      'Notification delivery failing',
      deliveryFailureTemplate({
        ...SCOPE,
        connectorName: 'Slack #payments-oncall',
        connectorType: 'slack',
        failedCount: 7,
        lastError: 'invalid_auth — the bot token was revoked',
        statusCode: 401,
        attempts: 5,
        deadLettered: true,
        firstFailedAt: '31 Jul 2026, 22:40 UTC',
        lastFailedAt: '1 Aug 2026, 01:10 UTC',
        connectorUrl: `${BASE}/settings/connectors/slack`,
      }),
    ),
    alert(
      'rule-updated',
      'Alert rule updated',
      ruleChangedTemplate({
        ...SCOPE,
        ruleName: 'Checkout p95 latency above 800 ms',
        action: 'updated',
        changedBy: 'Grace Hopper',
        changedAt: '1 Aug 2026, 00:58 UTC',
        changes: [
          'Threshold: 800 ms → 1500 ms',
          'Evaluation window: 5 min → 10 min',
          'Severity: critical → error',
        ],
        ruleUrl: `${BASE}/alerts/rules/rul_01JQ8Z`,
      }),
    ),
    alert(
      'rule-disabled',
      'Alert rule disabled',
      ruleChangedTemplate({
        ...SCOPE,
        ruleName: 'Ingestion lag above 60 s',
        action: 'disabled',
        changedBy: 'Grace Hopper',
        changedAt: '1 Aug 2026, 00:41 UTC',
        ruleUrl: `${BASE}/alerts/rules/rul_01JQ90`,
      }),
    ),
  ];
}

/* ── Gallery ──────────────────────────────────────────────────────────── */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The gallery itself is styled in the Mono palette so reviewers judge the
 * templates inside the same visual context the product lives in.
 */
function gallery(entries: PreviewEntry[]): string {
  const groups = [...new Set(entries.map((e) => e.group))];

  const sections = groups
    .map((group) => {
      const cards = entries
        .filter((e) => e.group === group)
        .map(
          (e) => `      <article class="card">
        <header>
          <div class="name">${escapeHtml(e.name)}</div>
          <div class="subject">${escapeHtml(e.template.subject)}</div>
        </header>
        <iframe src="./${e.slug}.html" title="${escapeHtml(e.name)}" loading="lazy"></iframe>
        <footer>
          <a href="./${e.slug}.html" target="_blank" rel="noreferrer">Open HTML</a>
          <a href="./${e.slug}.txt" target="_blank" rel="noreferrer">Plaintext</a>
          <a href="./${e.slug}.eml" download>Download .eml</a>
        </footer>
      </article>`,
        )
        .join('\n');
      return `    <section>
      <h2>${escapeHtml(group)}</h2>
      <div class="grid">
${cards}
      </div>
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Pulsiv email templates — Sentinel Mono</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@600&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg:#09090b; --bg1:#111113; --bg2:#18181b;
    --border:#26262a; --text:#fafafa; --text2:#a1a1aa; --text3:#8a8a94;
    --ai:#22d3ee;
    color-scheme: dark;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text2); font-family:'Inter',system-ui,sans-serif; }
  header.top { padding:40px 32px 28px; border-bottom:1px solid var(--border); }
  h1 { margin:0; font-family:'Space Grotesk',sans-serif; font-size:30px; font-weight:600; letter-spacing:-0.02em; color:var(--text); }
  .lede { margin:10px 0 0; font-size:14px; max-width:70ch; line-height:1.6; }
  .meta { margin-top:14px; font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:var(--text3); }
  main { padding:8px 32px 64px; }
  section { margin-top:40px; }
  h2 { font-family:'JetBrains Mono',monospace; font-size:11px; font-weight:500; letter-spacing:0.12em; text-transform:uppercase; color:var(--text3); margin:0 0 16px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); gap:20px; }
  .card { background:var(--bg1); border:1px solid var(--border); border-radius:10px; overflow:hidden; display:flex; flex-direction:column; }
  .card header { padding:14px 16px; border-bottom:1px solid var(--border); }
  .name { font-size:14px; font-weight:600; color:var(--text); }
  .subject { margin-top:5px; font-family:'JetBrains Mono',monospace; font-size:11px; line-height:1.5; color:var(--text3); word-break:break-word; }
  iframe { width:100%; height:620px; border:0; background:var(--bg); display:block; }
  .card footer { padding:11px 16px; border-top:1px solid var(--border); display:flex; gap:16px; }
  .card footer a { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--text2); text-decoration:none; border-bottom:1px solid transparent; }
  .card footer a:hover { color:var(--ai); border-bottom-color:var(--ai); }
</style>
</head>
<body>
  <header class="top">
    <h1>Email templates</h1>
    <p class="lede">
      Every transactional and alert email, rendered from the same component library.
      Theme is Sentinel <strong style="color:var(--text)">Mono</strong> — brand channel white,
      truth channel green/red/amber, AI channel cyan. Browsers do not execute the
      <code style="font-family:'JetBrains Mono',monospace">[if mso]</code> branches, so download the
      <code style="font-family:'JetBrains Mono',monospace">.eml</code> and open it in Outlook to verify the VML buttons.
    </p>
    <div class="meta">${entries.length} variants &middot; generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
  </header>
  <main>
${sections}
  </main>
</body>
</html>`;
}

/**
 * Minimal RFC 5322 multipart/alternative message.
 *
 * Base64 sidesteps quoted-printable line-length rules entirely, which matters
 * because the HTML has very long inline-style attributes that would otherwise
 * need soft line breaks in exactly the wrong places.
 */
function toEml(entry: PreviewEntry): string {
  const boundary = '----=_pulsiv_preview_boundary';
  const b64 = (s: string): string =>
    (Buffer.from(s, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');

  return [
    'MIME-Version: 1.0',
    'From: "Pulsiv" <alerts@pulsiv.io>',
    'To: "Preview" <preview@example.com>',
    `Subject: ${entry.template.subject}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(entry.template.text),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64(entry.template.html),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/* ── Entry point ──────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const outArgIndex = process.argv.indexOf('--out');
  const outDir = path.resolve(
    process.cwd(),
    outArgIndex >= 0 ? (process.argv[outArgIndex + 1] ?? 'reports/email-previews') : 'reports/email-previews',
  );

  await mkdir(outDir, { recursive: true });
  const entries = catalogue();

  await Promise.all(
    entries.flatMap((entry) => [
      writeFile(path.join(outDir, `${entry.slug}.html`), entry.template.html, 'utf8'),
      writeFile(path.join(outDir, `${entry.slug}.txt`), entry.template.text, 'utf8'),
      writeFile(path.join(outDir, `${entry.slug}.eml`), toEml(entry), 'utf8'),
    ]),
  );

  await writeFile(path.join(outDir, 'index.html'), gallery(entries), 'utf8');

  const widest = entries.reduce((max, e) => Math.max(max, e.name.length), 0);
  for (const entry of entries) {
    const kb = (Buffer.byteLength(entry.template.html, 'utf8') / 1024).toFixed(1);
    console.log(`  ${entry.name.padEnd(widest)}  ${kb.padStart(6)} KB  ${entry.template.subject}`);
  }

  console.log(`\n${entries.length} templates written to ${outDir}`);
  console.log(`Open ${path.join(outDir, 'index.html')}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
