import type { EmailTemplate } from "./templates.js";
type EmailMessage = EmailTemplate & {
    to: string;
};
export declare function sendEmail(message: EmailMessage): Promise<void>;
export {};
//# sourceMappingURL=mailer.d.ts.map