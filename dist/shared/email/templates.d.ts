/**
 * Transactional email templates — authentication, account and organization.
 *
 * Design: Sentinel "Mono" (see `./theme.ts`). Structure and client-hardening
 * live in `./components.ts`; this file is copy and composition only.
 *
 * ── Public contract ──────────────────────────────────────────────────────
 * Every exported function name and input shape is unchanged, so existing call
 * sites in `modules/auth`, `modules/organization` and `modules/user-account`
 * keep compiling untouched. Optional `context` fields let security mails report
 * request provenance — IP, device, timestamp — as callers adopt them.
 *
 * ── Composition ──────────────────────────────────────────────────────────
 * These mails continue the console's auth pages rather than a generic email
 * kit. Each one follows the same anatomy the sign-in page does:
 *
 *   headline        the outcome or the ask, in the auth heading's voice
 *   state line      only when the mail reports a verdict (MFA off, locked)
 *   one action      a single white button; red only for destruction
 *   quiet notes     expiry and the copy-me link sit under the action
 *   facts           request provenance as hairline rows
 *   one callout     only when it changes what the reader does next
 */
import { type DataRow, type FooterKind } from './components.js';
import type { Tone } from './theme.js';
export type EmailTemplate = {
    subject: string;
    html: string;
    text: string;
};
/**
 * Where a security-sensitive request came from.
 *
 * Optional on every template. When supplied it is rendered as provenance
 * facts, which is what turns "someone asked to reset your password" into an
 * actionable statement the recipient can verify or dispute.
 */
export interface RequestContext {
    ipAddress?: string | undefined;
    device?: string | undefined;
    location?: string | undefined;
    /** Pre-formatted, human-readable timestamp — formatting is the caller's job. */
    requestedAt?: string | undefined;
}
export type TemplateInput = {
    appName: string;
    userName?: string | undefined;
    context?: RequestContext | undefined;
};
export type ActionTemplateInput = TemplateInput & {
    actionUrl: string;
    expiresInMinutes: number;
};
export type MfaCodeTemplateInput = TemplateInput & {
    code: string;
    expiresInMinutes: number;
    purpose: 'setup' | 'login' | 'challenge';
    deviceName?: string | undefined;
};
export type OrgInvitationTemplateInput = TemplateInput & {
    actionUrl: string;
    orgName: string;
    inviterName?: string | undefined;
    roleLabel: string;
    expiresInDays: number;
    /** Whether the invited email already has an account on the platform. */
    accountExists: boolean;
};
export declare function passwordResetTemplate(input: ActionTemplateInput): EmailTemplate;
export declare function emailVerificationTemplate(input: ActionTemplateInput): EmailTemplate;
export declare function mfaCodeTemplate(input: MfaCodeTemplateInput): EmailTemplate;
export declare function mfaStatusTemplate(input: TemplateInput & {
    enabled: boolean;
}): EmailTemplate;
export declare function accountUnlockTemplate(input: ActionTemplateInput): EmailTemplate;
export declare function accountDeletionConfirmTemplate(input: ActionTemplateInput & {
    scheduledFor: string;
}): EmailTemplate;
export declare function mfaDisableConfirmTemplate(input: ActionTemplateInput): EmailTemplate;
/**
 * Organization invitation.
 *
 * The CTA points at the frontend invite page carrying the one-time token. When
 * the invitee has no account yet the copy nudges them to create one first; the
 * frontend reads the `accountExists` flag from the URL to pick the right screen
 * (sign in vs. create account).
 */
export declare function orgInvitationTemplate(input: OrgInvitationTemplateInput): EmailTemplate;
export declare function passwordChangedTemplate(input: TemplateInput): EmailTemplate;
/**
 * New-device sign-in notice.
 *
 * The highest-value security email a product can send: it is how account
 * takeover gets caught by the only person who can recognise it.
 */
export declare function newSignInTemplate(input: TemplateInput & {
    reviewUrl?: string | undefined;
}): EmailTemplate;
/**
 * API-key creation notice.
 *
 * An API key is a long-lived credential, so its creation deserves the same
 * out-of-band notification a password change gets. The key itself is never
 * emailed — only its prefix, enough to identify it during an audit.
 */
export declare function apiKeyCreatedTemplate(input: TemplateInput & {
    keyName: string;
    keyPrefix: string;
    projectName?: string | undefined;
    scopes?: string | undefined;
    manageUrl?: string | undefined;
}): EmailTemplate;
export interface StandardNotificationInput {
    appName?: string | undefined;
    title: string;
    subject?: string | undefined;
    /**
     * For a verdict tone this becomes the state-line label ("Critical",
     * "Degraded"); otherwise it names the header context.
     */
    eyebrowText?: string | undefined;
    preheader?: string | undefined;
    tone?: Tone | undefined;
    /** @deprecated Glyph chips are retired; the value is ignored. */
    chip?: string | undefined;
    userName?: string | undefined;
    summary?: string | undefined;
    message?: string | undefined;
    metric?: {
        label: string;
        value: string | number;
        threshold?: string | number | undefined;
        window?: string | undefined;
    } | undefined;
    details?: DataRow[] | undefined;
    primaryAction?: {
        label: string;
        url: string;
        /** Only `danger` changes the button — every other action is white. */
        tone?: Tone | undefined;
    } | undefined;
    secondaryAction?: {
        label: string;
        url: string;
    } | undefined;
    callout?: {
        tone?: Tone | undefined;
        title?: string | undefined;
        message: string;
    } | undefined;
    codeSnippet?: {
        code: string;
        caption?: string | undefined;
    } | undefined;
    context?: RequestContext | undefined;
    footerKind?: FooterKind | undefined;
    footerLink?: {
        url: string;
        label: string;
    } | undefined;
}
/**
 * Multi-purpose notification in the same sheet — general alerts, system
 * reports and connector notifications that have no dedicated template.
 */
export declare function standardNotificationTemplate(input: StandardNotificationInput): EmailTemplate;
//# sourceMappingURL=templates.d.ts.map