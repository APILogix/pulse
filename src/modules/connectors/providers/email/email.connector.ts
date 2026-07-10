/**
 * Email connector (SMTP).
 *
 * Uses per-connector SMTP credentials when supplied, otherwise falls back to
 * the platform SMTP_* env configuration (same transport the rest of the app
 * uses). Renders a minimal HTML + text body from the notification payload.
 */
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { ZodType } from 'zod';
import { BaseConnector } from '../../shared/base.connector.js';
import { env } from '../../../../config/env.js';
import {
  EmailConfigSchema,
  ConnectorDeliveryError,
  type ConnectionTestResult,
  type ConnectorContext,
  type ConnectorType,
  type DeliveryResult,
  type EmailConfig,
  type NotificationPayload,
} from '../../types.js';

const SEVERITY_LABEL: Record<string, string> = {
  info: 'ℹ️ Info',
  warning: '⚠️ Warning',
  error: '❌ Error',
  critical: '🚨 Critical',
};

export class EmailConnector extends BaseConnector {
  public readonly type: ConnectorType = 'email';
  private transporter: Transporter | null = null;

  constructor(ctx: ConnectorContext) {
    super(ctx);
  }

  protected get configSchema(): ZodType {
    return EmailConfigSchema;
  }

  supportsRichFormatting(): boolean { return true; }
  supportsThreading(): boolean { return false; }
  supportsAttachments(): boolean { return true; }

  private getTransporter(cfg: EmailConfig): Transporter {
    if (this.transporter) return this.transporter;

    if (cfg.smtp) {
      this.transporter = nodemailer.createTransport({
        host: cfg.smtp.host,
        port: cfg.smtp.port,
        secure: cfg.smtp.secure,
        auth: cfg.smtp.user && cfg.smtp.pass
          ? { user: cfg.smtp.user, pass: cfg.smtp.pass }
          : undefined,
      });
    } else {
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

  private renderHtml(n: NotificationPayload): string {
    const fieldsHtml = (n.fields ?? [])
      .map((f) => `<tr><td style="padding:4px 12px 4px 0;font-weight:600;">${escapeHtml(f.label)}</td><td style="padding:4px 0;">${escapeHtml(f.value)}</td></tr>`)
      .join('');
    const cta = n.url
      ? `<p><a href="${escapeAttr(n.url)}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">View details</a></p>`
      : '';
    return `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#111;">
      <p style="font-size:13px;color:#666;">${SEVERITY_LABEL[n.severity] ?? n.severity}</p>
      <h2 style="margin:0 0 12px;">${escapeHtml(n.title)}</h2>
      <p style="white-space:pre-wrap;">${escapeHtml(n.body)}</p>
      ${fieldsHtml ? `<table style="border-collapse:collapse;margin:12px 0;">${fieldsHtml}</table>` : ''}
      ${cta}
    </body></html>`;
  }

  private renderText(n: NotificationPayload): string {
    const fields = (n.fields ?? []).map((f) => `${f.label}: ${f.value}`).join('\n');
    return [
      `[${n.severity.toUpperCase()}] ${n.title}`,
      '',
      n.body,
      fields ? `\n${fields}` : '',
      n.url ? `\n${n.url}` : '',
    ].join('\n');
  }

  protected async deliver(notification: NotificationPayload): Promise<DeliveryResult> {
    const cfg = this.config<EmailConfig>();
    const transporter = this.getTransporter(cfg);
    const fromName = cfg.fromName ?? env.SMTP_FROM_NAME;
    const fromEmail = cfg.fromEmail ?? env.SMTP_FROM_EMAIL;

    const start = Date.now();
    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: cfg.to.join(', '),
        subject: `[${notification.severity.toUpperCase()}] ${notification.title}`,
        text: this.renderText(notification),
        html: this.renderHtml(notification),
      });
      return {
        success: true,
        externalMessageId: info.messageId,
        responseBody: Array.isArray(info.accepted) ? `accepted: ${info.accepted.length}` : '',
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'SMTP send failed';
      // Auth failures are not retryable; transient SMTP errors are.
      const isAuth = /auth|credential|535|534/i.test(message);
      throw new ConnectorDeliveryError(message, isAuth ? 'auth_error' : 'network_error', !isAuth);
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const cfg = this.config<EmailConfig>();
    const start = Date.now();
    try {
      const ok = await this.getTransporter(cfg).verify();
      return {
        success: Boolean(ok),
        message: ok ? 'SMTP connection verified' : 'SMTP verification failed',
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'SMTP verification failed',
        latencyMs: Date.now() - start,
      };
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ));
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '%22');
}
