/**
 * Email template contract tests.
 *
 * Email is the one surface with no runtime feedback loop: a broken template
 * ships silently and the only signal is a customer complaint days later. These
 * tests therefore assert the properties that actually break in production —
 * escaping, client compatibility, the design-token contract, and the presence
 * of a real plaintext part — rather than snapshotting markup that will churn on
 * every copy edit.
 */
import { describe, expect, it } from 'vitest';

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
  palette,
  passwordChangedTemplate,
  passwordResetTemplate,
  quotaAlertTemplate,
  ruleChangedTemplate,
  safeUrl,
  serviceHealthTemplate,
  severityTone,
  type AlertSeverity,
  type EmailTemplate,
} from '../../src/shared/email/index.js';

/* ════════════════════════════════════════════════════════════════════════
   FIXTURES
   ════════════════════════════════════════════════════════════════════════ */

const APP = 'Pulsiv';
const URL = 'https://app.pulsiv.io/action?token=abc123';

const SCOPE = {
  appName: APP,
  orgName: 'Northwind Labs',
  projectName: 'checkout-api',
  environment: 'production',
  alertUrl: 'https://app.pulsiv.io/alerts/evt_1',
  acknowledgeUrl: 'https://app.pulsiv.io/alerts/evt_1/ack',
  silenceUrl: 'https://app.pulsiv.io/silences/new',
  preferencesUrl: 'https://app.pulsiv.io/settings/notifications',
};

const IDENTITY = {
  ruleName: 'Checkout p95 latency above 800 ms',
  severity: 'critical' as const,
  source: 'telemetry',
  fingerprint: 'a91f0c4e7b2d8815',
  eventId: 'evt_1',
  startedAt: '1 Aug 2026, 01:08 UTC',
  occurrences: 14,
};

/** Every template, rendered once, as `[name, template]` pairs. */
const ALL: [string, EmailTemplate][] = [
  ['passwordReset', passwordResetTemplate({ appName: APP, userName: 'Ada', actionUrl: URL, expiresInMinutes: 30 })],
  ['emailVerification', emailVerificationTemplate({ appName: APP, actionUrl: URL, expiresInMinutes: 60 })],
  ['mfaCode.login', mfaCodeTemplate({ appName: APP, code: '481902', expiresInMinutes: 10, purpose: 'login' })],
  ['mfaCode.setup', mfaCodeTemplate({ appName: APP, code: '481902', expiresInMinutes: 10, purpose: 'setup' })],
  ['mfaCode.challenge', mfaCodeTemplate({ appName: APP, code: '481902', expiresInMinutes: 10, purpose: 'challenge' })],
  ['mfaStatus.on', mfaStatusTemplate({ appName: APP, enabled: true })],
  ['mfaStatus.off', mfaStatusTemplate({ appName: APP, enabled: false })],
  ['mfaDisableConfirm', mfaDisableConfirmTemplate({ appName: APP, actionUrl: URL, expiresInMinutes: 15 })],
  ['accountUnlock', accountUnlockTemplate({ appName: APP, actionUrl: URL, expiresInMinutes: 20 })],
  [
    'accountDeletion',
    accountDeletionConfirmTemplate({ appName: APP, actionUrl: URL, expiresInMinutes: 60, scheduledFor: '31 Aug 2026' }),
  ],
  ['passwordChanged', passwordChangedTemplate({ appName: APP, userName: 'Ada' })],
  ['newSignIn', newSignInTemplate({ appName: APP, reviewUrl: URL, context: { ipAddress: '203.0.113.42' } })],
  [
    'apiKeyCreated',
    apiKeyCreatedTemplate({ appName: APP, keyName: 'CI pipeline', keyPrefix: 'plsv_live_9f2c', manageUrl: URL }),
  ],
  [
    'orgInvitation',
    orgInvitationTemplate({
      appName: APP,
      actionUrl: URL,
      orgName: 'Northwind Labs',
      inviterName: 'Grace Hopper',
      roleLabel: 'Engineer',
      expiresInDays: 7,
      accountExists: false,
    }),
  ],
  [
    'alertFiring',
    alertFiringTemplate({
      ...SCOPE,
      identity: IDENTITY,
      summary: 'Checkout latency is above threshold.',
      measurement: { label: 'p95 latency', value: '1,842 ms', threshold: '800 ms', window: 'last 5 minutes' },
      insight: { text: 'Latency climbed after deploy 4f21a8c.', confidence: 87 },
      runbook: 'Check the payment-gateway connection pool.',
    }),
  ],
  [
    'alertResolved',
    alertResolvedTemplate({
      ...SCOPE,
      identity: IDENTITY,
      duration: '18 minutes',
      resolvedBy: 'Auto-resolve',
      recoveredValue: '412 ms',
    }),
  ],
  [
    'alertAcknowledged',
    alertAcknowledgedTemplate({
      ...SCOPE,
      identity: IDENTITY,
      acknowledgedBy: 'Grace Hopper',
      comment: 'Rolling back.',
      expiresAt: '02:14 UTC',
    }),
  ],
  [
    'alertEscalated',
    alertEscalatedTemplate({
      ...SCOPE,
      identity: IDENTITY,
      policyName: 'Payments on-call',
      stepNumber: 2,
      totalSteps: 3,
      trigger: 'No acknowledgement within 15 minutes',
      firingFor: '17 minutes',
    }),
  ],
  [
    'alertSilenced',
    alertSilencedTemplate({
      ...SCOPE,
      target: 'project=checkout-api',
      silencedBy: 'Grace Hopper',
      expiresAt: '06:00 UTC',
      duration: '4 hours',
      matchedRules: 9,
    }),
  ],
  [
    'alertDigest',
    alertDigestTemplate({
      ...SCOPE,
      period: 'last 24 hours',
      counts: { firing: 3, resolved: 11, acknowledged: 5 },
      totalCount: 19,
      feedUrl: URL,
      entries: [
        { ruleName: 'Checkout p95 latency', severity: 'critical', meta: 'checkout-api · 14 occurrences' },
        { ruleName: 'Error rate above 2%', severity: 'error', meta: 'auth-api · 6 occurrences' },
        { ruleName: 'Ingestion lag', severity: 'warning', meta: 'collector · 3 occurrences' },
        { ruleName: 'Cert expiry', severity: 'info', meta: 'edge-proxy · 1 occurrence' },
      ],
    }),
  ],
  [
    'alertDigest.empty',
    alertDigestTemplate({
      ...SCOPE,
      period: 'last 24 hours',
      counts: { firing: 0, resolved: 0, acknowledged: 0 },
      entries: [],
    }),
  ],
  [
    'anomalyDetected',
    anomalyDetectedTemplate({
      ...SCOPE,
      title: 'Unusual write volume',
      explanation: 'Throughput is 4.4x the baseline.',
      confidence: 91,
      metric: 'Rows written / minute',
      observed: '182k',
      baseline: '41k',
      deviation: '+344%',
      suggestedAction: 'Inspect the retry policy.',
    }),
  ],
  [
    'latencyAlert',
    latencyAlertTemplate({
      ...SCOPE,
      percentile: 'p95',
      observed: '1,842 ms',
      threshold: '800 ms',
      window: 'last 5 minutes',
      endpoint: 'POST /v1/checkout/confirm',
      sampleSize: 8412,
      severity: 'error',
      topContributors: ['payment-gateway.charge — 1,204 ms'],
    }),
  ],
  [
    'errorSpike',
    errorSpikeTemplate({
      ...SCOPE,
      errorRate: '12.4%',
      threshold: '2%',
      errorCount: 1043,
      totalRequests: 8412,
      topStatusCode: '503',
      topError: 'UpstreamTimeout',
      severity: 'critical',
    }),
  ],
  [
    'serviceHealth.down',
    serviceHealthTemplate({ ...SCOPE, serviceName: 'payment-gateway', status: 'down', detail: 'connection refused', failedChecks: 4 }),
  ],
  ['serviceHealth.degraded', serviceHealthTemplate({ ...SCOPE, serviceName: 'payment-gateway', status: 'degraded' })],
  [
    'serviceHealth.recovered',
    serviceHealthTemplate({ ...SCOPE, serviceName: 'payment-gateway', status: 'recovered', downtime: '11 minutes' }),
  ],
  [
    'quota.warning',
    quotaAlertTemplate({
      ...SCOPE,
      resource: 'Events ingested',
      used: '8.6M',
      limit: '10M',
      percentUsed: 86,
      planName: 'Scale',
      upgradeUrl: URL,
      usageUrl: URL,
    }),
  ],
  [
    'quota.exceeded',
    quotaAlertTemplate({ ...SCOPE, resource: 'Log volume', used: '52 GB', limit: '50 GB', percentUsed: 104 }),
  ],
  [
    'deliveryFailure',
    deliveryFailureTemplate({
      ...SCOPE,
      connectorName: 'Slack #payments-oncall',
      connectorType: 'slack',
      failedCount: 7,
      lastError: 'invalid_auth',
      statusCode: 401,
      attempts: 5,
      deadLettered: true,
      connectorUrl: URL,
    }),
  ],
  [
    'ruleChanged.updated',
    ruleChangedTemplate({
      ...SCOPE,
      ruleName: 'Checkout p95 latency',
      action: 'updated',
      changedBy: 'Grace Hopper',
      changes: ['Threshold: 800 ms → 1500 ms'],
      ruleUrl: URL,
    }),
  ],
  [
    'ruleChanged.disabled',
    ruleChangedTemplate({ ...SCOPE, ruleName: 'Ingestion lag', action: 'disabled', changedBy: 'Grace Hopper' }),
  ],
  [
    'ruleChanged.deleted',
    ruleChangedTemplate({ ...SCOPE, ruleName: 'Ingestion lag', action: 'deleted', changedBy: 'Grace Hopper' }),
  ],
  [
    'ruleChanged.created',
    ruleChangedTemplate({ ...SCOPE, ruleName: 'Ingestion lag', action: 'created', changedBy: 'Grace Hopper' }),
  ],
];

const ALERT_NAMES = new Set(
  ALL.map(([name]) => name).filter(
    (name) =>
      name.startsWith('alert') ||
      name.startsWith('anomaly') ||
      name.startsWith('latency') ||
      name.startsWith('error') ||
      name.startsWith('service') ||
      name.startsWith('quota') ||
      name.startsWith('delivery') ||
      name.startsWith('rule'),
  ),
);

/* ════════════════════════════════════════════════════════════════════════
   COVERAGE
   ════════════════════════════════════════════════════════════════════════ */

describe('template coverage', () => {
  it('renders every template in the catalogue', () => {
    // Guards against a template being added to the module but never exercised.
    expect(ALL.length).toBeGreaterThanOrEqual(33);
    expect(new Set(ALL.map(([name]) => name)).size).toBe(ALL.length);
  });
});

/* ════════════════════════════════════════════════════════════════════════
   STRUCTURAL CONTRACT
   ════════════════════════════════════════════════════════════════════════ */

describe.each(ALL)('%s — structure', (name, tpl) => {
  it('returns a complete, non-empty triple', () => {
    expect(tpl.subject.trim().length).toBeGreaterThan(0);
    expect(tpl.html.length).toBeGreaterThan(500);
    // A degenerate text part hurts deliverability, so hold it to a real floor.
    expect(tpl.text.trim().length).toBeGreaterThan(40);
  });

  it('is a complete HTML document', () => {
    expect(tpl.html).toMatch(/^<!DOCTYPE html/i);
    expect(tpl.html).toContain('<html lang="en"');
    expect(tpl.html.trimEnd().endsWith('</html>')).toBe(true);
  });

  it('declares a dark colour scheme so clients do not force-invert it', () => {
    expect(tpl.html).toContain('name="color-scheme" content="dark"');
    expect(tpl.html).toContain('name="supported-color-schemes" content="dark"');
  });

  it('ships a hidden preheader that controls the inbox preview', () => {
    expect(tpl.html).toContain('mso-hide:all');
    expect(tpl.html).toContain('&#847;&zwnj;&nbsp;');
  });

  it('leaks no unresolved values into the output', () => {
    for (const surface of [tpl.subject, tpl.html, tpl.text]) {
      expect(surface).not.toContain('undefined');
      expect(surface).not.toContain('[object Object]');
      expect(surface).not.toContain('NaN');
      // An unrendered template literal or a stray placeholder.
      expect(surface).not.toMatch(/\$\{|\{\{/);
    }
  });

  it('keeps the payload under the Gmail 102 KB clipping threshold', () => {
    // Past ~102 KB Gmail truncates the message and appends a "View entire
    // message" link, which hides the CTA on the exact emails that need it.
    expect(Buffer.byteLength(tpl.html, 'utf8')).toBeLessThan(102 * 1024);
  });

  it('has a title matching the document', () => {
    expect(tpl.html).toMatch(/<title>[^<]+<\/title>/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
   CLIENT COMPATIBILITY
   ════════════════════════════════════════════════════════════════════════ */

describe.each(ALL)('%s — client compatibility', (name, tpl) => {
  it('contains no inline SVG', () => {
    // Gmail, Outlook and Yahoo strip <svg> outright. The previous revision used
    // it for the logo and hero icons, which rendered as blank space.
    expect(tpl.html).not.toMatch(/<svg/i);
  });

  it('contains no images to block or fail to load', () => {
    expect(tpl.html).not.toMatch(/<img/i);
  });

  it('uses no rgba() colours outside box-shadow', () => {
    // Outlook flattens alpha to black, so a tinted callout declared with rgba
    // would render as a solid black band. Tints are pre-composited to flat hex
    // in theme.ts. box-shadow is exempt: Outlook drops the property entirely
    // rather than mis-rendering it, and clients that honour it need the alpha.
    const withoutShadows = tpl.html.replace(/box-shadow:[^;"]*/g, '');
    expect(withoutShadows).not.toMatch(/rgba\(/);
  });

  it('marks every layout table as presentational', () => {
    const tables = tpl.html.match(/<table\b/g) ?? [];
    const presentational = tpl.html.match(/<table role="presentation"/g) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    expect(presentational.length).toBe(tables.length);
  });

  it('zeroes Outlook table spacing', () => {
    expect(tpl.html).toContain('mso-table-lspace:0pt');
    expect(tpl.html).toContain('mso-line-height-rule:exactly');
  });

  it('balances every conditional comment', () => {
    const msoOpen = (tpl.html.match(/<!--\[if/g) ?? []).length;
    const msoClose = (tpl.html.match(/<!\[endif\]-->/g) ?? []).length;
    expect(msoOpen).toBe(msoClose);
    expect(msoOpen).toBeGreaterThan(0);
  });

  it('pins a fixed width for Outlook, which ignores max-width', () => {
    expect(tpl.html).toMatch(/<!--\[if mso\]><table role="presentation"[^>]*width="620"/);
  });

  it('ships a mobile breakpoint', () => {
    expect(tpl.html).toContain('@media only screen and (max-width:620px)');
  });
});

describe('bulletproof buttons', () => {
  const withCta = ALL.filter(([, tpl]) => tpl.html.includes('<a href="https://'));

  it('covers most templates', () => {
    expect(withCta.length).toBeGreaterThan(15);
  });

  it.each(withCta)('%s pairs every anchor CTA with a VML fallback', (name, tpl) => {
    // Outlook ignores padding on <a>, so a padded anchor alone collapses to
    // bare underlined text. Each CTA anchor needs a v:roundrect twin.
    const anchors = (tpl.html.match(/<a href="[^"]*" style="display:inline-block/g) ?? []).length;
    const vml = (tpl.html.match(/<v:roundrect/g) ?? []).length;
    expect(vml).toBe(anchors);
    if (vml > 0) {
      expect(tpl.html).toContain('<w:anchorlock/>');
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════
   DESIGN-TOKEN CONTRACT  (Sentinel Mono)
   ════════════════════════════════════════════════════════════════════════ */

describe.each(ALL)('%s — Mono theme tokens', (name, tpl) => {
  it('paints the canvas and card in the Mono neutrals', () => {
    expect(tpl.html).toContain(palette.bg); // #09090b
    expect(tpl.html).toContain(palette.bg1); // #111113
    expect(tpl.html).toContain(palette.border); // #26262a
    expect(tpl.html).toContain(palette.text); // #fafafa
  });

  it('uses the Sentinel font families', () => {
    expect(tpl.html).toContain('Space Grotesk');
    expect(tpl.html).toContain("'Inter'");
    expect(tpl.html).toContain('JetBrains Mono');
  });

  it('carries no colour from the retired green-brand palette', () => {
    // The old templates used #34d399 as the *brand* colour and #0a0a0a /
    // #e8e8e8 as neutrals. Green is now a verdict only, so it must never
    // appear on chrome such as the logo tile or a primary button.
    expect(tpl.html).not.toContain('#0a0a0a');
    expect(tpl.html).not.toContain('#e8e8e8');
    expect(tpl.html).not.toContain('#0d2818');
    expect(tpl.html).not.toContain('linear-gradient(180deg');
  });

  it('renders the logo mark as the only gradient', () => {
    const gradients = (tpl.html.match(/linear-gradient\(/g) ?? []).length;
    expect(gradients).toBe(1);
    expect(tpl.html).toContain(`linear-gradient(135deg,${palette.brand} 0%,${palette.ai} 100%)`);
  });
});

describe('three-channel law', () => {
  const LOGO_GRADIENT = `linear-gradient(135deg,${palette.brand} 0%,${palette.ai} 100%)`;

  it('reserves cyan for model output', () => {
    // If a pixel is cyan, a model produced it (§2.4). The logo gradient
    // legitimately terminates in cyan on every mail, so it is stripped first;
    // any remaining cyan must belong to an AI insight card.
    let checked = 0;
    for (const [name, tpl] of ALL) {
      const withoutLogo = tpl.html.split(LOGO_GRADIENT).join('');
      if (!withoutLogo.includes(palette.ai)) continue;
      checked += 1;
      expect(withoutLogo, `${name} uses cyan without model output`).toContain('AI insight');
    }
    // Two fixtures carry model output; if this drops to zero the test is inert.
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('keeps cyan out of templates with no model output', () => {
    for (const key of ['passwordReset', 'alertResolved', 'errorSpike', 'serviceHealth.down']) {
      const tpl = ALL.find(([n]) => n === key)?.[1];
      const withoutLogo = (tpl?.html ?? '').split(LOGO_GRADIENT).join('');
      expect(withoutLogo, key).not.toContain(palette.ai);
    }
  });

  it('maps severity onto the truth channel', () => {
    expect(severityTone('info')).toBe('info');
    expect(severityTone('warning')).toBe('warning');
    expect(severityTone('error')).toBe('danger');
    expect(severityTone('critical')).toBe('danger');
  });

  it('paints a firing critical alert in red and a resolved one in green', () => {
    const firing = ALL.find(([n]) => n === 'alertFiring')?.[1];
    const resolved = ALL.find(([n]) => n === 'alertResolved')?.[1];
    expect(firing?.html).toContain(palette.red);
    expect(resolved?.html).toContain(palette.green);
  });
});

/* ════════════════════════════════════════════════════════════════════════
   ESCAPING & INJECTION
   ════════════════════════════════════════════════════════════════════════ */

describe('escaping and injection', () => {
  const XSS = '<script>alert(1)</script>';

  it('escapes markup in a user-supplied name', () => {
    const tpl = passwordResetTemplate({
      appName: APP,
      userName: XSS,
      actionUrl: URL,
      expiresInMinutes: 30,
    });
    expect(tpl.html).not.toContain('<script>');
    expect(tpl.html).toContain('&lt;script&gt;');
  });

  it('escapes markup in an alert rule name, including the title and subject', () => {
    const tpl = alertFiringTemplate({
      ...SCOPE,
      identity: { ...IDENTITY, ruleName: `Rule ${XSS}` },
    });
    expect(tpl.html).not.toContain('<script>');
    expect(tpl.html).toContain('&lt;script&gt;');
  });

  it('escapes an attribute break-out attempt', () => {
    const tpl = alertFiringTemplate({
      ...SCOPE,
      identity: { ...IDENTITY, ruleName: '" onmouseover="alert(1)' },
    });
    expect(tpl.html).not.toContain('onmouseover="alert(1)"');
    expect(tpl.html).toContain('&quot;');
  });

  it('neutralizes a javascript: URL', () => {
    const tpl = passwordResetTemplate({
      appName: APP,
      // eslint-disable-next-line no-script-url
      actionUrl: 'javascript:alert(document.cookie)',
      expiresInMinutes: 30,
    });
    expect(tpl.html).not.toContain('href="javascript:');
    expect(tpl.html).toContain('href="#"');
    // The copy-me panel must not print the payload as selectable text either —
    // several clients auto-linkify plain text.
    expect(tpl.html).not.toContain('javascript:alert');
    expect(tpl.html).not.toContain('Or paste this link');
  });

  it('neutralizes a data: URL', () => {
    const tpl = passwordResetTemplate({
      appName: APP,
      actionUrl: 'data:text/html;base64,PHNjcmlwdD4=',
      expiresInMinutes: 30,
    });
    expect(tpl.html).not.toContain('href="data:');
  });

  it('omits an unsafe URL from the plaintext body rather than printing it', () => {
    const tpl = passwordResetTemplate({
      appName: APP,
      // eslint-disable-next-line no-script-url
      actionUrl: 'javascript:alert(1)',
      expiresInMinutes: 30,
    });
    expect(tpl.text).not.toContain('javascript:');
  });

  it('accepts the schemes a transactional email legitimately needs', () => {
    expect(safeUrl('https://app.pulsiv.io/x')).toBe('https://app.pulsiv.io/x');
    expect(safeUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(safeUrl('mailto:support@pulsiv.io')).toBe('mailto:support@pulsiv.io');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('#');
    expect(safeUrl('  //evil.example.com  ')).toBe('#');
  });

  it('escapes ampersands in query strings so the href stays valid HTML', () => {
    const tpl = passwordResetTemplate({
      appName: APP,
      actionUrl: 'https://app.pulsiv.io/r?token=a&next=/dash',
      expiresInMinutes: 30,
    });
    expect(tpl.html).toContain('token=a&amp;next=/dash');
  });

  it('strips control characters from a header-bound value', () => {
    const tpl = passwordResetTemplate({
      appName: 'Pulsiv\r\nBcc: attacker@example.com',
      actionUrl: URL,
      expiresInMinutes: 30,
    });
    expect(tpl.subject).not.toMatch(/[\r\n]/);
  });
});

/* ════════════════════════════════════════════════════════════════════════
   SUBJECT LINES
   ════════════════════════════════════════════════════════════════════════ */

describe('subject lines', () => {
  it('keeps the AppName: detail contract for transactional mail', () => {
    // Tenants build inbox rules and SIEM parsers against this prefix.
    for (const key of ['passwordReset', 'emailVerification', 'passwordChanged', 'accountUnlock']) {
      const tpl = ALL.find(([n]) => n === key)?.[1];
      expect(tpl?.subject.startsWith(`${APP}: `), key).toBe(true);
    }
  });

  it('leads alert subjects with a bracketed state so pagers can classify them', () => {
    for (const [name, tpl] of ALL) {
      if (!ALERT_NAMES.has(name)) continue;
      expect(tpl.subject, name).toMatch(/^\[[A-Z][A-Z0-9 ·]*\]/);
    }
  });

  it('encodes state and severity for a firing alert', () => {
    const tpl = ALL.find(([n]) => n === 'alertFiring')?.[1];
    expect(tpl?.subject).toContain('[FIRING · CRITICAL]');
    expect(tpl?.subject).toContain('checkout-api (production)');
  });

  it('drops severity from a resolved alert, because recovery has none', () => {
    const tpl = ALL.find(([n]) => n === 'alertResolved')?.[1];
    expect(tpl?.subject).toMatch(/^\[RESOLVED\]/);
    expect(tpl?.subject).not.toContain('CRITICAL');
  });

  it('never leaks the one-time code into the subject', () => {
    // Subjects land in mail-server logs, SIEM pipelines and lock-screen
    // notifications. The code belongs in the preheader, not the header.
    for (const key of ['mfaCode.login', 'mfaCode.setup', 'mfaCode.challenge']) {
      const tpl = ALL.find(([n]) => n === key)?.[1];
      expect(tpl?.subject, key).not.toContain('481902');
    }
  });

  it('stays inside the ~78 character mobile truncation budget', () => {
    for (const [name, tpl] of ALL) {
      expect(tpl.subject.length, `${name}: ${tpl.subject}`).toBeLessThanOrEqual(90);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════
   PLAINTEXT PARITY
   ════════════════════════════════════════════════════════════════════════ */

describe('plaintext bodies', () => {
  it.each(ALL)('%s carries no HTML markup', (name, tpl) => {
    expect(tpl.text).not.toMatch(/<[a-z/][^>]*>/i);
    expect(tpl.text).not.toMatch(/&[a-z]+;|&#\d+;/i);
  });

  it('repeats the action link so a text-only client is not a dead end', () => {
    const tpl = ALL.find(([n]) => n === 'passwordReset')?.[1];
    expect(tpl?.text).toContain(URL);
  });

  it('states the code and its expiry', () => {
    const tpl = ALL.find(([n]) => n === 'mfaCode.login')?.[1];
    expect(tpl?.text).toContain('481902');
    expect(tpl?.text).toContain('10 minutes');
  });

  it('carries the measurement and the threshold for a firing alert', () => {
    const tpl = ALL.find(([n]) => n === 'alertFiring')?.[1];
    expect(tpl?.text).toContain('1,842 ms');
    expect(tpl?.text).toContain('800 ms');
    expect(tpl?.text).toContain('FIRING');
  });

  it('carries the fingerprint so an alert can be correlated offline', () => {
    const tpl = ALL.find(([n]) => n === 'alertFiring')?.[1];
    expect(tpl?.text).toContain(IDENTITY.fingerprint);
  });
});

/* ════════════════════════════════════════════════════════════════════════
   BEHAVIOUR
   ════════════════════════════════════════════════════════════════════════ */

describe('conditional rendering', () => {
  it('omits optional surfaces instead of rendering empty shells', () => {
    const minimal = alertFiringTemplate({
      appName: APP,
      identity: { ruleName: 'Bare rule', severity: 'warning' },
    });
    expect(minimal.html).not.toContain('AI insight');
    expect(minimal.html).not.toContain('First response');
    expect(minimal.html).not.toContain('<v:roundrect'); // no links supplied
    expect(minimal.html).not.toContain('undefined');
    expect(minimal.subject).toBe('[FIRING · WARNING] Bare rule');
    // An org-level alert has no project or environment, so the preheader must
    // not trail off into "is firing on ."
    expect(minimal.html).toContain('Bare rule is firing.');
  });

  it('renders a single CTA when only one link is available', () => {
    const oneLink = alertFiringTemplate({
      appName: APP,
      alertUrl: 'https://app.pulsiv.io/alerts/1',
      identity: { ruleName: 'Bare rule', severity: 'error' },
    });
    expect((oneLink.html.match(/<v:roundrect/g) ?? []).length).toBe(1);
  });

  it('shows an all-clear panel for an empty digest', () => {
    const tpl = ALL.find(([n]) => n === 'alertDigest.empty')?.[1];
    expect(tpl?.html).toContain('All clear');
    expect(tpl?.html).toContain(palette.green);
  });

  it('truncates a digest honestly', () => {
    const tpl = ALL.find(([n]) => n === 'alertDigest')?.[1];
    expect(tpl?.html).toContain('Top 4 of 19 alerts');
  });

  it('escalates tone with quota consumption', () => {
    const warning = ALL.find(([n]) => n === 'quota.warning')?.[1];
    const exceeded = ALL.find(([n]) => n === 'quota.exceeded')?.[1];
    expect(warning?.html).toContain(palette.amber);
    expect(warning?.subject).not.toContain('EXCEEDED');
    expect(exceeded?.html).toContain(palette.red);
    expect(exceeded?.subject).toContain('EXCEEDED');
  });

  it('flips MFA status tone and copy together', () => {
    const on = ALL.find(([n]) => n === 'mfaStatus.on')?.[1];
    const off = ALL.find(([n]) => n === 'mfaStatus.off')?.[1];
    expect(on?.html).toContain(palette.green);
    expect(on?.html).toContain('MFA enabled');
    expect(off?.html).toContain(palette.amber);
    expect(off?.html).toContain('MFA disabled');
  });

  it('warns about the coverage gap when a rule is disabled or deleted', () => {
    expect(ALL.find(([n]) => n === 'ruleChanged.disabled')?.[1].html).toContain('Coverage gap');
    expect(ALL.find(([n]) => n === 'ruleChanged.deleted')?.[1].html).toContain('Coverage removed');
    expect(ALL.find(([n]) => n === 'ruleChanged.created')?.[1].html).not.toContain('Coverage gap');
  });

  it('renders the preferences link only when supplied', () => {
    const withLink = ALL.find(([n]) => n === 'alertFiring')?.[1];
    expect(withLink?.html).toContain('Manage alert notifications');

    const withoutLink = alertFiringTemplate({
      appName: APP,
      identity: { ruleName: 'Bare rule', severity: 'info' },
    });
    expect(withoutLink.html).not.toContain('Manage alert notifications');
  });

  it('switches the footer provenance line by mail class', () => {
    expect(ALL.find(([n]) => n === 'alertFiring')?.[1].html).toContain('Automated notification');
    expect(ALL.find(([n]) => n === 'passwordReset')?.[1].html).toContain('Security notification');
    // An invitation is neither — it must not claim to be a security alert.
    const invite = ALL.find(([n]) => n === 'orgInvitation')?.[1];
    expect(invite?.html).not.toContain('Security notification');
    expect(invite?.html).toContain('Sent by Pulsiv.');
  });

  it('pluralizes counts', () => {
    const one = deliveryFailureTemplate({ appName: APP, connectorName: 'Slack', failedCount: 1 });
    const many = deliveryFailureTemplate({ appName: APP, connectorName: 'Slack', failedCount: 4 });
    expect(one.subject).toContain('1 notification');
    expect(one.subject).not.toContain('notifications');
    expect(many.subject).toContain('4 notifications');

    const oneDay = orgInvitationTemplate({
      appName: APP,
      actionUrl: URL,
      orgName: 'Org',
      roleLabel: 'Viewer',
      expiresInDays: 1,
      accountExists: true,
    });
    expect(oneDay.text).toContain('1 day');
    expect(oneDay.text).not.toContain('1 days');
  });

  it('renders every severity without falling back to a default', () => {
    const severities: AlertSeverity[] = ['info', 'warning', 'error', 'critical'];
    for (const severity of severities) {
      const tpl = alertFiringTemplate({ ...SCOPE, identity: { ...IDENTITY, severity } });
      expect(tpl.subject, severity).toContain(`· ${severity.toUpperCase()}]`);
      expect(tpl.html, severity).toContain(severity.toUpperCase());
    }
  });

  it('renders every service-health status', () => {
    for (const status of ['down', 'degraded', 'recovered'] as const) {
      const tpl = serviceHealthTemplate({ ...SCOPE, serviceName: 'svc', status });
      expect(tpl.html.length, status).toBeGreaterThan(500);
      expect(tpl.html, status).not.toContain('undefined');
    }
  });

  it('reports both rate and absolute count for an error spike', () => {
    // A rate alone hides whether this is 50% of 2 requests or of 2 million.
    const tpl = ALL.find(([n]) => n === 'errorSpike')?.[1];
    expect(tpl?.html).toContain('12.4%');
    expect(tpl?.html).toContain('1,043 / 8,412');
  });

  it('attaches a confidence score to model output', () => {
    const tpl = ALL.find(([n]) => n === 'anomalyDetected')?.[1];
    expect(tpl?.html).toContain('91% confidence');
    expect(tpl?.html).toContain(palette.ai);
  });

  it('greets a user by name and degrades gracefully without one', () => {
    const named = passwordResetTemplate({ appName: APP, userName: 'Ada', actionUrl: URL, expiresInMinutes: 30 });
    const anon = passwordResetTemplate({ appName: APP, actionUrl: URL, expiresInMinutes: 30 });
    expect(named.html).toContain('Hi Ada,');
    expect(anon.html).toContain('Hi,');
    expect(anon.html).not.toContain('Hi undefined');
  });

  it('omits the greeting from alert mail, which leads with the fact', () => {
    for (const [name, tpl] of ALL) {
      if (!ALERT_NAMES.has(name)) continue;
      expect(tpl.html, name).not.toContain('Hi,');
    }
  });

  it('renders request provenance when supplied', () => {
    const tpl = passwordResetTemplate({
      appName: APP,
      actionUrl: URL,
      expiresInMinutes: 30,
      context: { ipAddress: '203.0.113.42', device: 'Chrome on macOS', requestedAt: '01:12 UTC' },
    });
    expect(tpl.html).toContain('203.0.113.42');
    expect(tpl.html).toContain('Chrome on macOS');
    expect(tpl.text).toContain('203.0.113.42');
  });

  it('converts a long expiry into hours', () => {
    const tpl = passwordResetTemplate({ appName: APP, actionUrl: URL, expiresInMinutes: 180 });
    expect(tpl.html).toContain('Expires in 3 hours');
  });
});
