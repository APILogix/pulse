type TemplateInput = {
    appName: string;
    userName?: string | undefined;
};
type ActionTemplateInput = TemplateInput & {
    actionUrl: string;
    expiresInMinutes: number;
};
type MfaCodeTemplateInput = TemplateInput & {
    code: string;
    expiresInMinutes: number;
    purpose: "setup" | "login" | "challenge";
    deviceName?: string;
};
export type EmailTemplate = {
    subject: string;
    html: string;
    text: string;
};
export declare function passwordResetTemplate(input: ActionTemplateInput): EmailTemplate;
export declare function emailVerificationTemplate(input: ActionTemplateInput): EmailTemplate;
export declare function mfaCodeTemplate(input: MfaCodeTemplateInput): EmailTemplate;
export declare function mfaStatusTemplate(input: TemplateInput & {
    enabled: boolean;
}): EmailTemplate;
export declare function emailChangeConfirmTemplate(input: ActionTemplateInput & {
    newEmail: string;
}): EmailTemplate;
export declare function accountUnlockTemplate(input: ActionTemplateInput): EmailTemplate;
export declare function accountDeletionConfirmTemplate(input: ActionTemplateInput & {
    scheduledFor: string;
}): EmailTemplate;
export declare function mfaDisableConfirmTemplate(input: ActionTemplateInput): EmailTemplate;
type OrgInvitationTemplateInput = TemplateInput & {
    actionUrl: string;
    orgName: string;
    inviterName?: string | undefined;
    roleLabel: string;
    expiresInDays: number;
    /** Whether the invited email already has an account on the platform. */
    accountExists: boolean;
};
/**
 * Organization invitation email. The CTA points at the frontend invite page
 * with the one-time token. When the invitee has no account yet, the copy nudges
 * them to create one first; the frontend uses the accountExists flag in the URL
 * to render the right screen (sign-in vs. create-account).
 */
export declare function orgInvitationTemplate(input: OrgInvitationTemplateInput): EmailTemplate;
export declare function passwordChangedTemplate(input: TemplateInput): EmailTemplate;
export {};
//# sourceMappingURL=templates.d.ts.map