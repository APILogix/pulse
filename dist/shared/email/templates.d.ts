type TemplateInput = {
    appName: string;
    userName?: string;
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
/**
 * Email sent when a user starts the MFA-disable flow. Contains a one-time
 * confirmation link the user must click to actually disable MFA. Until the
 * link is consumed, MFA remains in force, so a phished password + a stolen
 * TOTP cannot disable MFA on its own.
 */
export declare function emailChangeConfirmTemplate(input: ActionTemplateInput & {
    newEmail: string;
}): EmailTemplate;
export declare function accountUnlockTemplate(input: ActionTemplateInput): EmailTemplate;
export declare function accountDeletionConfirmTemplate(input: ActionTemplateInput & {
    scheduledFor: string;
}): EmailTemplate;
export declare function mfaDisableConfirmTemplate(input: ActionTemplateInput): EmailTemplate;
export {};
//# sourceMappingURL=templates.d.ts.map