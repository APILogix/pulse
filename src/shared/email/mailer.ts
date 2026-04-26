import nodemailer from "nodemailer";

import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { EmailTemplate } from "./templates.js";

type EmailMessage = EmailTemplate & {
  to: string;
};

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!env.SMTP_HOST) {
    throw new Error("SMTP_HOST is required to send email");
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER && env.SMTP_PASS
        ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        }
        : undefined,
    });
  }

  return transporter;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  try {
    const from = `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_EMAIL}>`;
    console.log("from",env.SMTP_FROM_EMAIL)
    await getTransporter().sendMail({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    console.log("email send succesfull")
  } catch (error) {
    logger.error(
      { err: error, to: message.to, subject: message.subject },
      "Failed to send email",
    );
    throw error;
  }
}
