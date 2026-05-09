import type { EmailTemplate } from "./templates.js";

export type EmailMessage = EmailTemplate & {
  to: string;
};

export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}
