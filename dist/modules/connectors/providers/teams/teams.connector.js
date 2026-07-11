import { BaseConnector } from '../../shared/base.connector.js';
import { httpRequest, classifyHttpStatus } from '../../shared/http.js';
import { TeamsConfigSchema, ConnectorDeliveryError, } from '../../types.js';
const SEVERITY_STYLE = {
    info: 'good',
    warning: 'warning',
    error: 'attention',
    critical: 'attention',
};
export class TeamsConnector extends BaseConnector {
    type = 'teams';
    get configSchema() {
        return TeamsConfigSchema;
    }
    supportsRichFormatting() { return true; }
    supportsThreading() { return false; }
    supportsAttachments() { return false; }
    buildCard(n) {
        const bodyItems = [
            {
                type: 'TextBlock',
                size: 'Large',
                weight: 'Bolder',
                text: n.title,
                wrap: true,
                color: SEVERITY_STYLE[n.severity] ?? 'default',
            },
            { type: 'TextBlock', text: n.body, wrap: true },
        ];
        if (n.fields?.length) {
            bodyItems.push({
                type: 'FactSet',
                facts: n.fields.slice(0, 20).map((f) => ({ title: f.label, value: f.value })),
            });
        }
        const actions = n.url
            ? [{ type: 'Action.OpenUrl', title: 'View details', url: n.url }]
            : [];
        return {
            type: 'message',
            attachments: [{
                    contentType: 'application/vnd.microsoft.card.adaptive',
                    content: {
                        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                        type: 'AdaptiveCard',
                        version: '1.4',
                        body: bodyItems,
                        ...(actions.length ? { actions } : {}),
                    },
                }],
        };
    }
    async deliver(notification) {
        const cfg = this.config();
        const start = Date.now();
        const res = await httpRequest(cfg.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.buildCard(notification)),
        });
        const latencyMs = Date.now() - start;
        if (res.ok) {
            return { success: true, statusCode: res.status, responseBody: res.body, latencyMs };
        }
        const { retryable, category } = classifyHttpStatus(res.status);
        throw new ConnectorDeliveryError(`Teams webhook returned ${res.status}: ${res.body.slice(0, 200)}`, category, retryable, { statusCode: res.status });
    }
    async testConnection() {
        const cfg = this.config();
        // Teams webhook has no metadata endpoint; only configuration presence is
        // verifiable without sending. A live send is exercised via /send.
        return {
            success: Boolean(cfg.webhookUrl),
            message: cfg.webhookUrl ? 'Webhook URL configured' : 'No webhook URL',
            latencyMs: 0,
        };
    }
}
//# sourceMappingURL=teams.connector.js.map