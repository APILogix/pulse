import { BaseConnector } from './shared/base.connector.js';
import { SlackConnector } from './providers/slack/slack.connector.js';
import { DiscordConnector } from './providers/discord/discord.connector.js';
import { TeamsConnector } from './providers/teams/teams.connector.js';
import { PagerDutyConnector } from './providers/pagerduty/pagerduty.connector.js';
import { WebhookConnector } from './providers/webhook/webhook.connector.js';
import { EmailConnector } from './providers/email/email.connector.js';
import { SmsConnector } from './providers/sms/sms.connector.js';
import { ConnectorTypeUnsupportedError, } from './types.js';
const registry = new Map();
/** Register (or override) a connector type. Idempotent by type key. */
export function registerConnectorType(type, entry) {
    registry.set(type, entry);
}
/** Whether a connector type is registered. */
export function isConnectorTypeRegistered(type) {
    return registry.has(type);
}
/** Factory: build a connector instance for a given context. */
export function createConnector(type, ctx) {
    const entry = registry.get(type);
    if (!entry)
        throw new ConnectorTypeUnsupportedError(type);
    return new entry.ctor(ctx);
}
/** Metadata for every registered connector type (powers GET /connectors/types). */
export function listConnectorTypes() {
    return [...registry.entries()].map(([type, entry]) => ({ ...entry.info, type }));
}
/** Capability flags for a type without instantiating it. */
export function getTypeCapabilities(type) {
    const entry = registry.get(type);
    if (!entry)
        throw new ConnectorTypeUnsupportedError(type);
    return entry.info.capabilities;
}
/**
 * Build a lightweight context for capability/validation checks that don't need
 * a real org/config (e.g. validating a create request before persistence).
 */
export function ephemeralContext(type, config, log) {
    return {
        id: '00000000-0000-0000-0000-000000000000',
        name: `validate-${type}`,
        organizationId: '00000000-0000-0000-0000-000000000000',
        config,
        rateLimit: { requests: 60, windowSeconds: 60 },
        log,
    };
}
// ── Built-in registrations ────────────────────────────────────────────────
registerConnectorType('slack', {
    ctor: SlackConnector,
    info: {
        type: 'slack',
        displayName: 'Slack',
        description: 'Post Block Kit messages via incoming webhook or bot token.',
        capabilities: { richFormatting: true, threading: true, attachments: true },
        configFields: [
            { key: 'webhookUrl', label: 'Incoming Webhook URL', required: false, secret: true, type: 'url' },
            { key: 'botToken', label: 'Bot Token', required: false, secret: true, type: 'string' },
            { key: 'defaultChannel', label: 'Default Channel', required: false, secret: false, type: 'string' },
        ],
    },
});
registerConnectorType('discord', {
    ctor: DiscordConnector,
    info: {
        type: 'discord',
        displayName: 'Discord',
        description: 'Post rich embeds via Discord webhooks with thread support.',
        capabilities: { richFormatting: true, threading: true, attachments: false },
        configFields: [
            { key: 'webhookUrl', label: 'Webhook URL', required: true, secret: true, type: 'url' },
            { key: 'username', label: 'Override Username', required: false, secret: false, type: 'string' },
            { key: 'avatarUrl', label: 'Override Avatar URL', required: false, secret: false, type: 'url' },
        ],
    },
});
registerConnectorType('teams', {
    ctor: TeamsConnector,
    info: {
        type: 'teams',
        displayName: 'Microsoft Teams',
        description: 'Send Adaptive Cards via an Incoming Webhook connector.',
        capabilities: { richFormatting: true, threading: false, attachments: false },
        configFields: [
            { key: 'webhookUrl', label: 'Connector Webhook URL', required: true, secret: true, type: 'url' },
        ],
    },
});
registerConnectorType('pagerduty', {
    ctor: PagerDutyConnector,
    info: {
        type: 'pagerduty',
        displayName: 'PagerDuty',
        description: 'Trigger incidents via the Events API v2.',
        capabilities: { richFormatting: false, threading: false, attachments: false },
        configFields: [
            { key: 'routingKey', label: 'Integration Routing Key', required: true, secret: true, type: 'string' },
        ],
    },
});
registerConnectorType('webhook', {
    ctor: WebhookConnector,
    info: {
        type: 'webhook',
        displayName: 'Generic Webhook',
        description: 'POST a signed JSON envelope to any HTTPS endpoint.',
        capabilities: { richFormatting: false, threading: false, attachments: false },
        configFields: [
            { key: 'url', label: 'Endpoint URL', required: true, secret: false, type: 'url' },
            { key: 'method', label: 'HTTP Method', required: false, secret: false, type: 'string' },
            { key: 'headers', label: 'Custom Headers', required: false, secret: false, type: 'string' },
            { key: 'signingSecret', label: 'Signing Secret', required: false, secret: true, type: 'string' },
        ],
    },
});
registerConnectorType('email', {
    ctor: EmailConnector,
    info: {
        type: 'email',
        displayName: 'Email (SMTP)',
        description: 'Send templated email via per-connector or platform SMTP.',
        capabilities: { richFormatting: true, threading: false, attachments: true },
        configFields: [
            { key: 'to', label: 'Recipients', required: true, secret: false, type: 'array' },
            { key: 'fromEmail', label: 'From Email', required: false, secret: false, type: 'string' },
            { key: 'smtp', label: 'SMTP Override', required: false, secret: true, type: 'string' },
        ],
    },
});
registerConnectorType('sms', {
    ctor: SmsConnector,
    info: {
        type: 'sms',
        displayName: 'SMS (Twilio)',
        description: 'Send SMS alerts via Twilio.',
        capabilities: { richFormatting: false, threading: false, attachments: false },
        configFields: [
            { key: 'accountSid', label: 'Account SID', required: true, secret: true, type: 'string' },
            { key: 'authToken', label: 'Auth Token', required: true, secret: true, type: 'string' },
            { key: 'fromNumber', label: 'From Number', required: true, secret: false, type: 'string' },
            { key: 'toNumbers', label: 'Recipient Numbers', required: true, secret: false, type: 'array' },
        ],
    },
});
//# sourceMappingURL=registry.js.map