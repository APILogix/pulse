/**
 * Transactional email templates — authentication, account and organization.
 *
 * Design: Sentinel "Mono" (see `./theme.ts`). Structure and client-hardening
 * live in `./components.ts`; this file is copy and composition only.
 *
 * ── Public contract ──────────────────────────────────────────────────────
 * Every exported function name and input shape is unchanged from the previous
 * revision, so existing call sites in `modules/auth`, `modules/organization`
 * and `modules/user-account` keep compiling untouched. Optional `context`
 * fields were *added* (never required) so security mails can start reporting
 * request provenance — IP, device, timestamp — as callers adopt them.
 *
 * ── What changed visually ────────────────────────────────────────────────
 *   · Brand channel is white, not green. Green now means only "resolved /
 *     healthy / succeeded", per the three-channel law (sentinel-design.md §0).
 *     The old templates used green as the brand colour, which made every
 *     verdict colour ambiguous.
 *   · Inline SVG logo and hero icons removed — Gmail, Outlook and Yahoo strip
 *     `<svg>`, so those were rendering as blank space for most recipients.
 *   · Header gradient removed (§3 forbids gradients in chrome; the logo mark is
 *     the only permitted gradient).
 *   · Added preheaders, a severity rail, bulletproof VML buttons, a responsive
 *     breakpoint, dark-mode locks and real plaintext bodies.
 */
import { TEXT_RULE, button, buttonRow, callout, codeBlock, dataTable, esc, glyph, linkFallback, metricCompare, otpBlock, p, pill, renderLayout, safeUrlText, stack, strong, stripControl, textBody, textGreeting, textRows, } from './components.js';
/* ════════════════════════════════════════════════════════════════════════
   SHARED COMPOSITION
   ════════════════════════════════════════════════════════════════════════ */
/**
 * Subject format is `AppName: detail`.
 *
 * Preserved verbatim from the previous revision — tenants build inbox rules and
 * SIEM parsers against this prefix, so changing it is a breaking change even
 * though it is "just a string".
 */
function subjectLine(appName, detail) {
    return `${stripControl(appName)}: ${detail}`;
}
/** Provenance rows, or `null` when the caller supplied no context. */
function contextRows(context) {
    if (!context)
        return null;
    const rows = [];
    if (context.requestedAt)
        rows.push({ label: 'Requested', value: context.requestedAt });
    if (context.device)
        rows.push({ label: 'Device', value: context.device, sans: true });
    if (context.ipAddress)
        rows.push({ label: 'IP address', value: context.ipAddress });
    if (context.location)
        rows.push({ label: 'Location', value: context.location, sans: true });
    return rows.length > 0 ? rows : null;
}
function contextTable(context) {
    const rows = contextRows(context);
    return rows ? dataTable(rows) : '';
}
function contextText(context) {
    const rows = contextRows(context);
    if (!rows)
        return '';
    return `Request details\n${TEXT_RULE}\n${textRows(rows.map((r) => ({ label: r.label, value: r.value })))}`;
}
/** `Expires in 15 minutes` — a pill so the deadline is scannable, not buried. */
function expiryPill(minutes) {
    const label = minutes >= 120
        ? `Expires in ${Math.round(minutes / 60)} hours`
        : `Expires in ${minutes} minute${minutes === 1 ? '' : 's'}`;
    return pill(label, 'neutral');
}
/** Standard "wasn't me" escape hatch for link-based flows. */
const IGNORE_NOTE = 'If you did not request this, you can ignore this email &mdash; nothing changes until the link is used. Repeated messages you did not ask for may mean someone is probing your account; turn on multi-factor authentication if it is off.';
/* ════════════════════════════════════════════════════════════════════════
   PASSWORD RESET
   ════════════════════════════════════════════════════════════════════════ */
export function passwordResetTemplate(input) {
    const title = 'Reset your password';
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p(`Use the button below to choose a new password for your ${esc(input.appName)} account. The link works once and then expires.`),
        expiryPill(input.expiresInMinutes),
        button(input.actionUrl, 'Reset password'),
        linkFallback(input.actionUrl),
        contextTable(input.context),
        callout('warning', IGNORE_NOTE, 'Not you?'),
    ]);
    return {
        subject: subjectLine(input.appName, 'Reset your password'),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText: 'Security · password reset',
            preheader: `Your password reset link expires in ${input.expiresInMinutes} minutes.`,
            tone: 'brand',
            chip: glyph.key,
            body,
            footer: 'security',
            closing: null,
        }),
        text: textBody(textGreeting(input.userName), `Use this link to choose a new password for your ${input.appName} account. It works once and expires in ${input.expiresInMinutes} minutes.`, safeUrlText(input.actionUrl), contextText(input.context), 'Did not request this? Ignore this email — nothing changes until the link is used.'),
    };
}
/* ════════════════════════════════════════════════════════════════════════
   EMAIL VERIFICATION
   ════════════════════════════════════════════════════════════════════════ */
export function emailVerificationTemplate(input) {
    const title = 'Verify your email';
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p(`Confirm this address to finish setting up your ${esc(input.appName)} account. Verification also unlocks email-based recovery, so you are not locked out if you lose your password.`),
        expiryPill(input.expiresInMinutes),
        button(input.actionUrl, 'Verify email'),
        linkFallback(input.actionUrl),
        contextTable(input.context),
    ]);
    return {
        subject: subjectLine(input.appName, 'Verify your email address'),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText: 'Account · verification',
            preheader: `Confirm your email address to activate your ${input.appName} account.`,
            tone: 'brand',
            chip: glyph.mail,
            body,
            footer: 'security',
            closing: 'If you did not create this account, you can safely ignore this email.',
        }),
        text: textBody(textGreeting(input.userName), `Confirm this email address to finish setting up your ${input.appName} account. The link expires in ${input.expiresInMinutes} minutes.`, safeUrlText(input.actionUrl), contextText(input.context), 'If you did not create this account, you can safely ignore this email.'),
    };
}
/* ════════════════════════════════════════════════════════════════════════
   MFA — ONE-TIME CODE
   ════════════════════════════════════════════════════════════════════════ */
export function mfaCodeTemplate(input) {
    const title = input.purpose === 'setup'
        ? 'Confirm email MFA setup'
        : input.purpose === 'login'
            ? 'Your sign-in code'
            : 'Your verification code';
    const eyebrowText = input.purpose === 'setup'
        ? 'Security · MFA setup'
        : input.purpose === 'login'
            ? 'Security · sign-in code'
            : 'Security · verification';
    const forDevice = input.deviceName ? ` for ${esc(input.deviceName)}` : '';
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p(`Enter this code to continue${forDevice}.`),
        otpBlock(input.code),
        expiryPill(input.expiresInMinutes),
        contextTable(input.context),
        callout('warning', `Anyone with this code can act as you. ${esc(input.appName)} staff will never ask for it &mdash; not by email, chat or phone. If you did not trigger this, change your password now.`, 'Never share this code'),
    ]);
    return {
        // Subject deliberately excludes the code: subjects land in mail-server
        // logs, SIEM pipelines and lock-screen notifications. The preheader carries
        // it instead, which reaches the recipient without the same fan-out.
        subject: subjectLine(input.appName, title),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText,
            // The code is repeated in the preheader so a phone or watch preview is
            // often enough — no need to open the message at all.
            preheader: `${stripControl(input.code)} — expires in ${input.expiresInMinutes} minutes. Never share this code.`,
            tone: 'brand',
            chip: glyph.key,
            body,
            footer: 'security',
            closing: null,
        }),
        text: textBody(textGreeting(input.userName), `Your ${input.appName} verification code is ${stripControl(input.code)}`, `It expires in ${input.expiresInMinutes} minutes.`, contextText(input.context), `Never share this code. ${input.appName} staff will never ask for it.`),
    };
}
/* ════════════════════════════════════════════════════════════════════════
   MFA — STATUS CHANGED
   ════════════════════════════════════════════════════════════════════════ */
export function mfaStatusTemplate(input) {
    const enabled = input.enabled;
    const title = enabled ? 'Multi-factor authentication is on' : 'Multi-factor authentication is off';
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p(enabled
            ? `Multi-factor authentication is now active on your ${esc(input.appName)} account. Sign-ins from a new device will require a second factor.`
            : `Multi-factor authentication was turned off on your ${esc(input.appName)} account. A password alone can now sign in.`),
        pill(enabled ? 'MFA enabled' : 'MFA disabled', enabled ? 'success' : 'warning'),
        contextTable(input.context),
        enabled
            ? callout('neutral', 'Generate backup recovery codes in security settings so a lost device cannot lock you out.', 'Next step')
            : callout('warning', `Your account is materially less secure without a second factor. If you did not do this, re-enable MFA and change your password immediately &mdash; ${esc(input.appName)} will never disable it for you.`, 'Recommended action'),
    ]);
    return {
        subject: subjectLine(input.appName, enabled ? 'Multi-factor authentication enabled' : 'Multi-factor authentication disabled'),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText: enabled ? 'Security · MFA enabled' : 'Security · MFA disabled',
            preheader: enabled
                ? 'A second factor is now required to sign in.'
                : 'Your account is now protected by a password alone.',
            tone: enabled ? 'success' : 'warning',
            chip: enabled ? glyph.check : glyph.bang,
            body,
            footer: 'security',
            closing: null,
        }),
        text: textBody(textGreeting(input.userName), `Multi-factor authentication was ${enabled ? 'enabled for' : 'disabled on'} your ${input.appName} account.`, contextText(input.context), enabled
            ? 'Next step: generate backup recovery codes in security settings.'
            : 'If this was not you, re-enable MFA and change your password immediately.'),
    };
}
/* ════════════════════════════════════════════════════════════════════════
   ACCOUNT UNLOCK
   ════════════════════════════════════════════════════════════════════════ */
export function accountUnlockTemplate(input) {
    const title = 'Unlock your account';
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p('Your account was locked automatically after too many failed sign-in attempts. That lock is a brute-force defence, not a penalty — use the button below to restore access.'),
        expiryPill(input.expiresInMinutes),
        button(input.actionUrl, 'Unlock account'),
        linkFallback(input.actionUrl),
        contextTable(input.context),
        callout('warning', 'If those attempts were not yours, someone is guessing your password. Reset it and turn on multi-factor authentication before signing back in.', 'Not you?'),
    ]);
    return {
        subject: subjectLine(input.appName, 'Unlock your account'),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText: 'Security · account locked',
            preheader: `Restore access to your ${input.appName} account — link expires in ${input.expiresInMinutes} minutes.`,
            tone: 'warning',
            chip: glyph.square,
            body,
            footer: 'security',
            closing: null,
        }),
        text: textBody(textGreeting(input.userName), 'Your account was locked after too many failed sign-in attempts.', `Unlock it here (expires in ${input.expiresInMinutes} minutes):`, safeUrlText(input.actionUrl), contextText(input.context), 'If those attempts were not yours, reset your password and enable MFA.'),
    };
}
/* ════════════════════════════════════════════════════════════════════════
   ACCOUNT DELETION
   ════════════════════════════════════════════════════════════════════════ */
export function accountDeletionConfirmTemplate(input) {
    const title = 'Confirm account deletion';
    const rows = [
        { label: 'Scheduled for', value: input.scheduledFor, tone: 'danger' },
        { label: 'Scope', value: 'Account, sessions, API keys, telemetry', sans: true },
        { label: 'Reversible', value: 'Only before the scheduled date', sans: true },
    ];
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p(`You asked to delete your ${esc(input.appName)} account. Confirming schedules permanent erasure &mdash; it does not happen straight away, which gives you a window to change your mind.`),
        dataTable(rows),
        button(input.actionUrl, 'Confirm deletion', { tone: 'danger' }),
        linkFallback(input.actionUrl),
        contextTable(input.context),
        callout('danger', 'After the scheduled date this cannot be undone. Projects, dashboards, alert rules, API keys and ingested telemetry are erased permanently, and any organization you solely own is removed with them. Export anything you need first.', 'This is permanent'),
    ]);
    return {
        subject: subjectLine(input.appName, 'Confirm account deletion'),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText: 'Account · deletion requested',
            preheader: `Deletion is scheduled for ${input.scheduledFor}. Confirm to proceed, or ignore to cancel.`,
            tone: 'danger',
            chip: glyph.cross,
            body,
            footer: 'security',
            closing: 'Did not request this? Do nothing — the request expires on its own and your account stays active.',
        }),
        text: textBody(textGreeting(input.userName), `You requested deletion of your ${input.appName} account. Permanent erasure is scheduled for ${stripControl(input.scheduledFor)}.`, 'Confirm:', safeUrlText(input.actionUrl), contextText(input.context), 'This cannot be undone after the scheduled date. If you did not request this, do nothing.'),
    };
}
/* ════════════════════════════════════════════════════════════════════════
   MFA DISABLE — CONFIRMATION
   ════════════════════════════════════════════════════════════════════════ */
export function mfaDisableConfirmTemplate(input) {
    const title = 'Confirm turning off MFA';
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p(`Someone asked to disable multi-factor authentication on your ${esc(input.appName)} account. Because that removes a security layer, it needs confirmation from this inbox.`),
        expiryPill(input.expiresInMinutes),
        button(input.actionUrl, 'Confirm and disable MFA', { tone: 'warning' }),
        linkFallback(input.actionUrl),
        contextTable(input.context),
        callout('danger', `If this was not you, ${strong('do nothing')} &mdash; MFA stays on and the request expires. Then change your password, because whoever made this request may already know it.`, 'Not you? Do nothing'),
    ]);
    return {
        subject: subjectLine(input.appName, 'Confirm MFA disable request'),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText: 'Security · MFA disable',
            preheader: 'Confirmation required to remove your second factor. Ignore this email to keep MFA on.',
            tone: 'warning',
            chip: glyph.bang,
            body,
            footer: 'security',
            closing: null,
        }),
        text: textBody(textGreeting(input.userName), `A request was made to disable multi-factor authentication on your ${input.appName} account.`, `Confirm (expires in ${input.expiresInMinutes} minutes):`, safeUrlText(input.actionUrl), contextText(input.context), 'If this was not you, do nothing — MFA stays enabled. Then change your password immediately.'),
    };
}
/* ════════════════════════════════════════════════════════════════════════
   ORGANIZATION INVITATION
   ════════════════════════════════════════════════════════════════════════ */
/**
 * Organization invitation.
 *
 * The CTA points at the frontend invite page carrying the one-time token. When
 * the invitee has no account yet the copy nudges them to create one first; the
 * frontend reads the `accountExists` flag from the URL to pick the right screen
 * (sign in vs. create account).
 */
export function orgInvitationTemplate(input) {
    const title = `Join ${stripControl(input.orgName)} on ${stripControl(input.appName)}`;
    const inviterLine = input.inviterName
        ? `${strong(input.inviterName)} invited you to join ${strong(input.orgName)}.`
        : `You have been invited to join ${strong(input.orgName)}.`;
    const nextStep = input.accountExists
        ? 'Sign in with this email address to accept.'
        : 'You will create your account as part of accepting — it takes about a minute.';
    const rows = [
        { label: 'Organization', value: input.orgName, sans: true },
        { label: 'Your role', value: input.roleLabel, sans: true },
        {
            label: 'Invite expires',
            value: `${input.expiresInDays} day${input.expiresInDays === 1 ? '' : 's'}`,
        },
    ];
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p(inviterLine),
        dataTable(rows),
        p(esc(nextStep), { muted: true }),
        button(input.actionUrl, 'Accept invitation'),
        linkFallback(input.actionUrl),
    ]);
    return {
        subject: subjectLine(input.appName, `Join ${stripControl(input.orgName)}`),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText: 'Invitation',
            preheader: `${input.inviterName ? `${stripControl(input.inviterName)} invited you` : 'You have been invited'} to ${stripControl(input.orgName)} as ${stripControl(input.roleLabel)}.`,
            tone: 'brand',
            chip: glyph.plus,
            body,
            footer: 'plain',
            closing: `Not expecting this? You can ignore it &mdash; the invitation expires on its own in ${input.expiresInDays} day${input.expiresInDays === 1 ? '' : 's'}.`,
        }),
        text: textBody(textGreeting(input.userName), `${input.inviterName ? `${stripControl(input.inviterName)} invited you` : 'You have been invited'} to join ${stripControl(input.orgName)} on ${input.appName} as ${stripControl(input.roleLabel)}.`, textRows(rows.map((r) => ({ label: r.label, value: r.value }))), nextStep, 'Accept:', safeUrlText(input.actionUrl), `This invitation expires in ${input.expiresInDays} day${input.expiresInDays === 1 ? '' : 's'}.`),
    };
}
/* ════════════════════════════════════════════════════════════════════════
   PASSWORD CHANGED
   ════════════════════════════════════════════════════════════════════════ */
export function passwordChangedTemplate(input) {
    const title = 'Your password was changed';
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p(`The password on your ${esc(input.appName)} account was changed. If that was you, nothing more is needed &mdash; this message exists so an unexpected change cannot go unnoticed.`),
        pill('Password updated', 'success'),
        contextTable(input.context),
        callout('warning', 'If you did not make this change, your account is compromised. Reset your password from a device you trust, sign out every other session, and turn on multi-factor authentication.', 'Was this not you?'),
    ]);
    return {
        subject: subjectLine(input.appName, 'Your password was changed'),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText: 'Security · password changed',
            preheader: 'Confirming a password change on your account. If this was not you, act now.',
            tone: 'success',
            chip: glyph.check,
            body,
            footer: 'security',
            closing: null,
        }),
        text: textBody(textGreeting(input.userName), `The password for your ${input.appName} account was changed.`, contextText(input.context), 'If this was not you, reset your password, sign out all sessions and enable MFA immediately.'),
    };
}
/* ════════════════════════════════════════════════════════════════════════
   NEW SIGN-IN  (new template)
   ════════════════════════════════════════════════════════════════════════ */
/**
 * New-device sign-in notice.
 *
 * The highest-value security email a product can send: it is how account
 * takeover gets caught by the only person who can recognise it.
 */
export function newSignInTemplate(input) {
    const title = 'New sign-in to your account';
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p(`Your ${esc(input.appName)} account was signed in to from a device we have not seen before.`),
        contextTable(input.context) || pill('New device', 'info'),
        input.reviewUrl ? button(input.reviewUrl, 'Review active sessions') : '',
        input.reviewUrl ? linkFallback(input.reviewUrl) : '',
        callout('warning', 'If this was not you, change your password and sign out every session right away. Anyone still signed in keeps their access until you do.', 'Was this not you?'),
    ]);
    return {
        subject: subjectLine(input.appName, 'New sign-in to your account'),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText: 'Security · new sign-in',
            preheader: 'A device we have not seen before signed in to your account.',
            tone: 'info',
            chip: glyph.dot,
            body,
            footer: 'security',
            closing: null,
        }),
        text: textBody(textGreeting(input.userName), `Your ${input.appName} account was signed in to from a new device.`, contextText(input.context), input.reviewUrl ? `Review sessions: ${safeUrlText(input.reviewUrl)}` : '', 'If this was not you, change your password and revoke all sessions immediately.'),
    };
}
/* ════════════════════════════════════════════════════════════════════════
   API KEY CREATED  (new template)
   ════════════════════════════════════════════════════════════════════════ */
/**
 * API-key creation notice.
 *
 * An API key is a long-lived credential, so its creation deserves the same
 * out-of-band notification a password change gets. The key itself is never
 * emailed — only its prefix, enough to identify it during an audit.
 */
export function apiKeyCreatedTemplate(input) {
    const title = 'A new API key was created';
    const rows = [
        { label: 'Key name', value: input.keyName, sans: true },
        { label: 'Prefix', value: `${input.keyPrefix}…` },
    ];
    if (input.projectName)
        rows.push({ label: 'Project', value: input.projectName, sans: true });
    if (input.scopes)
        rows.push({ label: 'Scopes', value: input.scopes, sans: true });
    const body = stack([
        p(esc(textGreeting(input.userName))),
        p(`A new API key was created on your ${esc(input.appName)} account.`),
        dataTable(rows),
        contextTable(input.context),
        input.manageUrl ? button(input.manageUrl, 'Manage API keys') : '',
        callout('warning', 'The key value is shown only once, at creation, and is never sent by email. If you did not create this key, revoke it now — an API key bypasses interactive sign-in and multi-factor prompts entirely.', 'Did not create this?'),
    ]);
    return {
        subject: subjectLine(input.appName, `New API key created — ${stripControl(input.keyName)}`),
        html: renderLayout({
            appName: input.appName,
            title,
            eyebrowText: 'Security · API key created',
            preheader: `${stripControl(input.keyName)} (${stripControl(input.keyPrefix)}…) was just created.`,
            tone: 'info',
            chip: glyph.key,
            body,
            footer: 'security',
            closing: null,
        }),
        text: textBody(textGreeting(input.userName), `A new API key was created on your ${input.appName} account.`, textRows(rows.map((r) => ({ label: r.label, value: r.value }))), contextText(input.context), input.manageUrl ? `Manage keys: ${safeUrlText(input.manageUrl)}` : '', 'If you did not create this key, revoke it immediately.'),
    };
}
/**
 * Standard multi-purpose notification email template rendered in Sentinel Mono design.
 * Suitable for general alerts, system reports, digests, and operational notifications.
 */
export function standardNotificationTemplate(input) {
    const app = input.appName || 'Pulsiv';
    const tone = input.tone ?? 'brand';
    const title = stripControl(input.title);
    const eyebrow = input.eyebrowText ?? `${app} · notification`;
    const subject = input.subject ?? subjectLine(app, title);
    const rows = input.details ? [...input.details] : [];
    let actionsHtml = '';
    if (input.primaryAction && input.secondaryAction) {
        actionsHtml = buttonRow(input.primaryAction, input.secondaryAction);
    }
    else if (input.primaryAction) {
        actionsHtml = stack([
            button(input.primaryAction.url, input.primaryAction.label, { tone: input.primaryAction.tone ?? tone }),
            linkFallback(input.primaryAction.url),
        ]);
    }
    const metricHtml = input.metric
        ? metricCompare({
            label: input.metric.window ? `${input.metric.label} · ${input.metric.window}` : input.metric.label,
            value: String(input.metric.value),
            threshold: input.metric.threshold !== undefined ? String(input.metric.threshold) : '—',
            tone,
        })
        : '';
    const calloutHtml = input.callout
        ? callout(input.callout.tone ?? 'neutral', esc(input.callout.message), input.callout.title)
        : '';
    const codeHtml = input.codeSnippet
        ? codeBlock(input.codeSnippet.code)
        : '';
    const body = stack([
        input.userName ? p(esc(textGreeting(input.userName))) : '',
        input.summary ? p(esc(input.summary)) : '',
        input.message ? p(esc(input.message)) : '',
        metricHtml,
        rows.length > 0 ? dataTable(rows) : '',
        actionsHtml,
        calloutHtml,
        codeHtml,
        contextTable(input.context),
    ]);
    const preheaderText = input.preheader
        ? stripControl(input.preheader)
        : input.summary
            ? stripControl(input.summary)
            : `${title} on ${app}`;
    return {
        subject,
        html: renderLayout({
            appName: app,
            title,
            eyebrowText: eyebrow,
            preheader: preheaderText,
            tone,
            chip: input.chip,
            body,
            footer: input.footerKind ?? 'alert',
            footerLink: input.footerLink,
            closing: null,
        }),
        text: textBody(input.userName ? textGreeting(input.userName) : '', title, input.summary, input.message, input.metric ? `${input.metric.label}: ${input.metric.value}${input.metric.threshold ? ` (threshold: ${input.metric.threshold})` : ''}` : '', rows.length > 0 ? textRows(rows.map((r) => ({ label: r.label, value: r.value }))) : '', input.primaryAction ? `${input.primaryAction.label}: ${safeUrlText(input.primaryAction.url)}` : '', input.secondaryAction ? `${input.secondaryAction.label}: ${safeUrlText(input.secondaryAction.url)}` : '', input.callout ? `${input.callout.title ? `${input.callout.title}: ` : ''}${input.callout.message}` : '', input.codeSnippet ? input.codeSnippet.code : '', contextText(input.context)),
    };
}
/* ── end of templates ── */
//# sourceMappingURL=templates.js.map