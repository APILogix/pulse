import nodemailer from "nodemailer";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
let transporter = null;
function getTransporter() {
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
export async function sendEmail(message) {
    const from = `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_EMAIL}>`;
    console.log(`[EMAIL] 📧 Sending email | To: "${message.to}" | From: "${from}" | Subject: "${message.subject}" | SMTP Host: "${env.SMTP_HOST}:${env.SMTP_PORT}"`);
    if (message.text) {
        const preview = message.text.length > 300 ? `${message.text.slice(0, 300)}...` : message.text;
        console.log(`[EMAIL] 📄 Preview:\n${preview}`);
    }
    try {
        const info = await getTransporter().sendMail({
            from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
        });
        console.log(`[EMAIL] ✅ Email sent successfully! | MessageId: "${info.messageId}" | Response: "${info.response}" | To: "${message.to}"`);
        logger.info({ to: message.to, subject: message.subject, messageId: info.messageId }, "Email delivered successfully");
    }
    catch (error) {
        console.error(`[EMAIL] ❌ Failed to send email to "${message.to}" | Subject: "${message.subject}" | Error:`, error);
        logger.error({ err: error, to: message.to, subject: message.subject }, "Failed to send email");
        throw error;
    }
}
//# sourceMappingURL=mailer.js.map