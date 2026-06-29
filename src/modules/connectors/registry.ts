/**
 * Connector registry + factory (Plugin + Factory patterns).
 *
 * - Plugin architecture: connector types register a constructor at module load
 *   via `registerConnectorType`. New providers are added by registering here;
 *   nothing else in the system needs to change.
 * - Factory: `createConnector` instantiates the right Strategy implementation
 *   for a stored config row, injecting a {@link ConnectorContext}.
 *
 * The registry is a process-wide singleton; registration is idempotent.
 */
import type { FastifyBaseLogger } from 'fastify';
import { BaseConnector } from './connectors/base.connector.js';
import { SlackConnector } from './connectors/slack.connector.js';
import { DiscordConnector } from './connectors/discord.connector.js';
import { TeamsConnector } from './connectors/teams.connector.js';
import { PagerDutyConnector } from './connectors/pagerduty.connector.js';
import { WebhookConnector } from './connectors/webhook.connector.js';
import { EmailConnector } from './connectors/email.connector.js';
import { SmsConnector } from './connectors/sms.connector.js';
import {
  ConnectorTypeUnsupportedError,
  type ConnectorContext,
  type ConnectorType,
  type ConnectorTypeInfoDto,
} from './types.js';

type ConnectorConstructor = new (ctx: ConnectorContext) => BaseConnector;

interface RegistryEntry {
  ctor: ConnectorConstructor;
  info: Omit<ConnectorTypeInfoDto, 'capabilities'> & {
    capabilities: ConnectorTypeInfoDto['capabilities'];
  };
}

const registry = new Map<ConnectorType, RegistryEntry>();

/** Register (or override) a connector type. Idempotent by type key. */
export function registerConnectorType(type: ConnectorType, entry: RegistryEntry): void {
  registry.set(type, entry);
}

/** Whether a connector type is registered. */
export function isConnectorTypeRegistered(type: string): type is ConnectorType {
  return registry.has(type as ConnectorType);
}

/** Factory: build a connector instance for a given context. */
export function createConnector(type: ConnectorType, ctx: ConnectorContext): BaseConnector {
  const entry = registry.get(type);
  if (!entry) throw new ConnectorTypeUnsupportedError(type);
  return new entry.ctor(ctx);
}

/** Metadata for every registered connector type (powers GET /connectors/types). */
export function listConnectorTypes(): ConnectorTypeInfoDto[] {
  return [...registry.entries()].map(([type, entry]) => ({ ...entry.info, type }));
}

/** Capability flags for a type without instantiating it. */
export function getTypeCapabilities(type: ConnectorType): ConnectorTypeInfoDto['capabilities'] {
  const entry = registry.get(type);
  if (!entry) throw new ConnectorTypeUnsupportedError(type);
  return entry.info.capabilities;
}

/**
 * Build a lightweight context for capability/validation checks that don't need
 * a real org/config (e.g. validating a create request before persistence).
 */
export function ephemeralContext(
  type: ConnectorType,
  config: Record<string, unknown>,
  log: FastifyBaseLogger,
): ConnectorContext {
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
