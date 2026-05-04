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
export {};
//# sourceMappingURL=templates.d.ts.map