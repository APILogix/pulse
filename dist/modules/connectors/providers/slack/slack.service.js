import { randomBytes } from 'crypto';
import { httpRequest } from '../../shared/http.js';
import { ConnectorService } from '../../service.js';
import { ConnectorRepository } from '../../repository.js';
import { ConnectorError, ConnectorNotFoundError } from '../../core/connector.types.js';
import { encryptConfig, decryptConfig } from '../../secrets/secret.service.js';
import { env } from '../../../../config/env.js';
export class SlackService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async startOAuth(orgId, actorUserId, actorIp, actorUserAgent) {
        // 1. Create a pending connector to hold the state
        const actorContext = { actorUserId, actorIp, actorUserAgent, requestId: randomBytes(16).toString('hex') };
        const connector = await this.deps.connectorService.createConnector(orgId, actorContext, {
            type: 'slack',
            name: `Slack Connection (${randomBytes(4).toString('hex')})`,
            description: 'Slack OAuth Integration',
            config: { pendingOAuth: true },
            displayConfig: {},
        });
        const { state } = await this.deps.connectorService.startOAuth(orgId, actorContext, connector.id);
        // Slack v2 OAuth does not support PKCE — state-only flow by design.
        const clientId = env.SLACK_CLIENT_ID || '';
        const redirectUri = env.SLACK_REDIRECT_URI || '';
        const scopes = 'chat:write,channels:read,groups:read,team:read';
        const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
        return { url, connectorId: connector.id };
    }
    async handleCallback(code, state) {
        const row = await this.deps.repository.withTransaction(async (client) => {
            return this.deps.repository.findOAuthStateWithConnector(client, state);
        });
        if (!row) {
            throw new ConnectorError('Invalid or expired OAuth state', 'CONNECTOR_OAUTH_STATE_INVALID', 400);
        }
        const { connector_id: connectorId, organization_id: orgId } = row;
        const clientId = env.SLACK_CLIENT_ID || '';
        const clientSecret = env.SLACK_CLIENT_SECRET || '';
        const redirectUri = env.SLACK_REDIRECT_URI || '';
        const tokenRes = await httpRequest('https://slack.com/api/oauth.v2.access', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
            }).toString(),
        });
        if (!tokenRes.ok) {
            throw new ConnectorError('Failed to exchange code with Slack', 'SLACK_OAUTH_FAILED', 400);
        }
        const data = JSON.parse(tokenRes.body);
        if (!data.ok) {
            throw new ConnectorError(`Slack OAuth error: ${data.error}`, 'SLACK_OAUTH_FAILED', 400);
        }
        const botToken = data.access_token;
        const botUserId = data.bot_user_id;
        const teamId = data.team?.id;
        const teamName = data.team?.name;
        await this.deps.repository.upsertCredential({
            organizationId: orgId,
            connectorId,
            credentialType: 'config',
            keyName: 'config',
            encryptedValue: encryptConfig({ botToken }),
            expiresAt: null,
            actorUserId: null,
        });
        await this.deps.repository.update(orgId, connectorId, {
            status: 'active',
            name: `Slack (${teamName})`,
            metadata: {
                teamId,
                teamName,
                botUserId,
                oauthScope: data.scope,
            },
        });
        await this.deps.repository.withTransaction(async (client) => {
            await this.deps.repository.deleteOAuthState(client, row.id);
        });
        return { connectorId, orgId };
    }
    async listChannels(orgId, connectorId) {
        const cred = await this.deps.repository.getCredential(orgId, connectorId, 'config');
        if (!cred)
            throw new ConnectorNotFoundError(connectorId);
        const decrypted = decryptConfig(cred.encrypted_value);
        if (!decrypted.botToken) {
            throw new ConnectorError('No Slack bot token found for this connector', 'SLACK_TOKEN_MISSING', 400);
        }
        const token = typeof decrypted.botToken === 'string' ? decrypted.botToken : '';
        const res = await httpRequest('https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=100', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        if (!res.ok) {
            throw new ConnectorError('Failed to fetch channels from Slack', 'SLACK_API_ERROR', 400);
        }
        const data = JSON.parse(res.body);
        if (!data.ok) {
            throw new ConnectorError(`Slack error: ${data.error}`, 'SLACK_API_ERROR', 400);
        }
        return { channels: data.channels.map((c) => ({ id: c.id, name: c.name, isPrivate: c.is_private })) };
    }
}
//# sourceMappingURL=slack.service.js.map