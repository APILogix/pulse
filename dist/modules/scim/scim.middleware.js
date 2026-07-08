import { createHash } from 'crypto';
import { logAudit } from '../../shared/middleware/audit-logger.js';
import * as authRepository from '../auth/infrastructure/repositories/index.js';
import { AuthError, AuthErrorCodes } from '../auth/domain/types.js';
function hashScimToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
export async function authenticateScim(request, reply) {
    const { orgId } = request.params;
    if (!orgId) {
        return reply.status(401).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '401',
            detail: 'Missing organization id',
        });
    }
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '401',
            detail: 'Bearer token required',
        });
    }
    const rawToken = authHeader.slice(7).trim();
    if (!rawToken.startsWith('scim_')) {
        return reply.status(401).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '401',
            detail: 'Invalid token format',
        });
    }
    const tokenRow = await authRepository.findScimTokenByHash(hashScimToken(rawToken), orgId);
    if (!tokenRow || tokenRow.org_id !== orgId) {
        return reply.status(401).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '401',
            detail: 'Unauthorized',
        });
    }
    const now = new Date();
    const expired = tokenRow.expires_at !== null && new Date(tokenRow.expires_at) <= now;
    const revoked = tokenRow.revoked_at !== null && new Date(tokenRow.revoked_at) <= now;
    const inGrace = tokenRow.grace_period_ends_at !== null &&
        new Date(tokenRow.grace_period_ends_at) > now;
    if ((expired || revoked) && !inGrace) {
        return reply.status(401).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '401',
            detail: 'Token expired or revoked',
        });
    }
    const ipAllowed = await authRepository.isScimTokenIpAllowed(tokenRow.id, request.ip);
    if (!ipAllowed) {
        logAudit({
            user_id: null,
            org_id: tokenRow.org_id,
            actor_type: 'scim',
            actor_id: tokenRow.id,
            action: 'scim.auth.ip_denied',
            resource_type: 'scim_token',
            resource_id: tokenRow.id,
            ip_address: request.ip,
            request_id: request.id,
            metadata: { client_ip: request.ip },
            ...(typeof request.headers['user-agent'] === 'string'
                ? { user_agent: request.headers['user-agent'] }
                : {}),
        });
        return reply.status(403).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '403',
            detail: 'IP not allowed',
        });
    }
    await authRepository.touchScimToken(tokenRow.id);
    request.scim = {
        orgId: tokenRow.org_id,
        tokenId: tokenRow.id,
        scopes: tokenRow.scopes ?? [],
        ipAddress: request.ip,
    };
}
export function assertScimOrg(request, orgId) {
    if (request.scim?.orgId !== orgId) {
        throw new AuthError('SCIM token org mismatch', AuthErrorCodes.SCIM_UNAUTHORIZED, 403);
    }
}
export function requireScimScope(request, reply, scope) {
    const scopes = request.scim?.scopes ?? [];
    if (scopes.length === 0 || !scopes.includes(scope)) {
        reply.status(403).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '403',
            detail: `Missing scope: ${scope}`,
        });
        return false;
    }
    return true;
}
//# sourceMappingURL=scim.middleware.js.map