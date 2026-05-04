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
    try {
        const from = `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_EMAIL}>`;
        console.log("from", env.SMTP_FROM_EMAIL);
        await getTransporter().sendMail({
            from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
        });
        console.log("email send succesfull");
    }
    catch (error) {
        logger.error({ err: error, to: message.to, subject: message.subject }, "Failed to send email");
        throw error;
    }
}
//# sourceMappingURL=mailer.js.map