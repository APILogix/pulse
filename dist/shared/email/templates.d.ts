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
export type EmailTemplate = {
    subject: string;
    html: string;
    text: string;
};
/**
 * Where a security-sensitive request came from.
 *
 * Optional on every template. When supplied it is rendered as a provenance
 * table, which is what turns "someone asked to reset your password" into an
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
//# sourceMappingURL=templates.d.ts.map