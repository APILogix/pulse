/**
 * Email connector (SMTP).
 *
 * Uses per-connector SMTP credentials when supplied, otherwise falls back to
 * the platform SMTP_* env configuration (same transport the rest of the app
 * uses). Alerts render through the enterprise alert formatter; everything else
 * renders through the shared Mono notification template.
 */
import nodemailer from 'nodemailer';
import { BaseConnector } from '../../shared/base.connector.js';
import { env } from '../../../../config/env.js';
import { EmailConfigSchema, ConnectorDeliveryError, } from '../../types.js';
import { renderEnterpriseAlertEmail } from '../../../alerting/runtime/alert-notification-formatter.js';
import { standardNotificationTemplate } from '../../../../shared/email/index.js';
/** Severity → the Mono truth channel, the same mapping alert mail uses. */
const SEVERITY_TONE = {
    info: 'info',
    warning: 'warning',
    error: 'danger',
    critical: 'danger',
};
const SEVERITY_LABEL = {
    info: 'Info',
    warning: 'Warning',
    error: 'Error',
    critical: 'Critical',
};
export class EmailConnector extends BaseConnector {
    type = 'email';
    transporter = null;
    constructor(ctx) {
        super(ctx);
    }
    get configSchema() {
        return EmailConfigSchema;
    }
    supportsRichFormatting() { return true; }
    supportsThreading() { return false; }
    supportsAttachments() { return true; }
    getTransporter(cfg) {
        if (this.transporter)
            return this.transporter;
        if (cfg.smtp) {
            this.transporter = nodemailer.createTransport({
                host: cfg.smtp.host,
                port: cfg.smtp.port,
                secure: cfg.smtp.secure,
                auth: cfg.smtp.user && cfg.smtp.pass
                    ? { user: cfg.smtp.user, pass: cfg.smtp.pass }
                    : undefined,
            });
        }
        else {
            if (!env.SMTP_HOST) {
                throw new ConnectorDeliveryError('No SMTP configured for email connector', 'invalid_config', false);
            }
            this.transporter = nodemailer.createTransport({
                host: env.SMTP_HOST,
                port: env.SMTP_PORT,
                secure: env.SMTP_SECURE,
                auth: env.SMTP_USER && env.SMTP_PASS
                    ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
                    : undefined,
            });
        }
        return this.transporter;
    }
    /**
     * Non-alert notifications (connector tests, generic payloads) render through
     * the shared Mono template, so they arrive in the same sheet as every other
     * Pulsiv email instead of an unstyled light page.
     */
    renderFallback(n, subject) {
        return standardNotificationTemplate({
            appName: env.APP_NAME,
            title: n.title,
            subject,
            eyebrowText: SEVERITY_LABEL[n.severity] ?? n.severity,
            tone: SEVERITY_TONE[n.severity] ?? 'info',
            message: n.body,
            details: (n.fields ?? []).map((f) => ({ label: f.label, value: f.value, sans: true })),
            primaryAction: n.url ? { label: 'View details', url: n.url } : undefined,
            footerKind: 'alert',
        });
    }
    async deliver(notification) {
        const cfg = this.config();
        const transporter = this.getTransporter(cfg);
        const fromName = cfg.fromName ?? env.SMTP_FROM_NAME;
        const fromEmail = cfg.fromEmail ?? env.SMTP_FROM_EMAIL;
        const start = Date.now();
        try {
            const projectChannel = notification.metadata?.projectChannel;
            const destination = typeof projectChannel?.destination === 'string' && projectChannel.destination.trim()
                ? projectChannel.destination.trim()
                : null;
            const isAlert = Boolean(notification.notificationType?.startsWith('alert')
                || notification.metadata?.alertKey
                || notification.metadata?.ruleId
                || notification.metadata?.endpoint
                || notification.metadata?.policy);
            const enterprise = isAlert
                ? renderEnterpriseAlertEmail({ payload: notification })
                : null;
            const subject = enterprise?.subject
                ?? (typeof notification.metadata?.subject === 'string' ? notification.metadata.subject : `[${notification.severity.toUpperCase()}] ${notification.title}`);
            const rendered = enterprise ?? this.renderFallback(notification, subject);
            const text = rendered.text;
            const html = rendered.html;
            const destinationTarget = (destination ? [destination] : cfg.to).join(', ');
            console.log(`\n[ALERT_EMAIL_CONNECTOR] 📨 Delivering connector email | To: "${destinationTarget}" | Subject: "${subject}"`);
            if (text) {
                const preview = text.length > 300 ? `${text.slice(0, 300)}...` : text;
                console.log(`[ALERT_EMAIL_CONNECTOR] 📄 Text Preview:\n--------------------------------------------------\n${preview}\n--------------------------------------------------`);
            }
            const info = await transporter.sendMail({
                from: `"${fromName}" <${fromEmail}>`,
                to: destinationTarget,
                subject,
                text,
                html,
            });
            console.log(`[ALERT_EMAIL_CONNECTOR] ✅ Connector email delivered | MessageId: "${info.messageId}" | To: "${destinationTarget}" | Latency: ${Date.now() - start}ms`);
            return {
                success: true,
                externalMessageId: info.messageId,
                responseBody: Array.isArray(info.accepted) ? `accepted: ${info.accepted.length}` : '',
                latencyMs: Date.now() - start,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'SMTP send failed';
            console.error(`[ALERT_EMAIL_CONNECTOR] ❌ Connector email delivery failed:`, message);
            // Auth failures are not retryable; transient SMTP errors are.
            const isAuth = /auth|credential|535|534/i.test(message);
            throw new ConnectorDeliveryError(message, isAuth ? 'auth_error' : 'network_error', !isAuth);
        }
    }
    async testConnection() {
        const cfg = this.config();
        const start = Date.now();
        try {
            const ok = await this.getTransporter(cfg).verify();
            return {
                success: Boolean(ok),
                message: ok ? 'SMTP connection verified' : 'SMTP verification failed',
                latencyMs: Date.now() - start,
            };
        }
        catch (err) {
            return {
                success: false,
                message: err instanceof Error ? err.message : 'SMTP verification failed',
                latencyMs: Date.now() - start,
            };
        }
    }
}
//# sourceMappingURL=email.connector.js.map