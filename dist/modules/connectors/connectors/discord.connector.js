import { BaseConnector } from './base.connector.js';
import { httpRequest, classifyHttpStatus } from './http.js';
import { DiscordConfigSchema, ConnectorDeliveryError, } from '../types.js';
// Discord embed color is a decimal integer.
const SEVERITY_COLOR = {
    info: 0x36a64f,
    warning: 0xdaa038,
    error: 0xd64f4f,
    critical: 0xa30000,
};
export class DiscordConnector extends BaseConnector {
    type = 'discord';
    get configSchema() {
        return DiscordConfigSchema;
    }
    supportsRichFormatting() { return true; }
    supportsThreading() { return true; }
    supportsAttachments() { return false; }
    buildPayload(n, cfg) {
        const embed = {
            title: n.title.slice(0, 256),
            description: n.body.slice(0, 4096),
            color: SEVERITY_COLOR[n.severity] ?? SEVERITY_COLOR.info,
            timestamp: new Date().toISOString(),
            ...(n.url ? { url: n.url } : {}),
        };
        if (n.fields?.length) {
            embed.fields = n.fields.slice(0, 25).map((f) => ({
                name: f.label.slice(0, 256),
                value: f.value.slice(0, 1024),
                inline: f.short ?? false,
            }));
        }
        return {
            ...(cfg.username ? { username: cfg.username } : {}),
            ...(cfg.avatarUrl ? { avatar_url: cfg.avatarUrl } : {}),
            embeds: [embed],
        };
    }
    async deliver(notification) {
        const cfg = this.config();
        const payload = this.buildPayload(notification, cfg);
        let url = cfg.webhookUrl;
        if (notification.threadKey) {
            const sep = url.includes('?') ? '&' : '?';
            url = `${url}${sep}thread_id=${encodeURIComponent(notification.threadKey)}`;
        }
        // wait=true makes Discord return the created message object (with id).
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}wait=true`;
        const start = Date.now();
        const res = await httpRequest(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const latencyMs = Date.now() - start;
        if (res.ok) {
            let externalMessageId = '';
            try {
                externalMessageId = JSON.parse(res.body).id ?? '';
            }
            catch { /* ignore */ }
            return { success: true, statusCode: res.status, externalMessageId, responseBody: res.body, latencyMs };
        }
        const { retryable, category } = classifyHttpStatus(res.status);
        throw new ConnectorDeliveryError(`Discord webhook returned ${res.status}: ${res.body.slice(0, 200)}`, category, retryable, { statusCode: res.status });
    }
    async testConnection() {
        const cfg = this.config();
        const start = Date.now();
        try {
            // GET on a webhook URL returns its metadata without posting a message.
            const res = await httpRequest(cfg.webhookUrl, { method: 'GET' });
            return {
                success: res.ok,
                message: res.ok ? 'Webhook reachable' : `Webhook returned ${res.status}`,
                latencyMs: Date.now() - start,
            };
        }
        catch (err) {
            return {
                success: false,
                message: err instanceof Error ? err.message : 'Connection test failed',
                latencyMs: Date.now() - start,
            };
        }
    }
}
//# sourceMappingURL=discord.connector.js.map