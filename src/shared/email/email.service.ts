import { sendEmail } from "./mailer.js";
import type { EmailMessage, EmailService } from "./email.types.js";

export const emailService: EmailService = {
  send(message: EmailMessage) {
    return sendEmail(message);
  },
};
