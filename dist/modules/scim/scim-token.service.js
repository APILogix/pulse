import { createHash, randomBytes } from 'crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import * as repository from '../auth/infrastructure/repositories/index.js';
import { withTransaction } from '../auth/infrastructure/repositories/index.js';
import { logAudit } from '../../shared/middleware/audit-logger.js';
const tokenLogger = logger.child({ component: 'scim-token-service' });
function hashScimToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
export class ScimTokenService {
    async createToken(input) {
        return withTransaction(async (client) => {
            return this.createTokenInTransaction(input, client);
        });
    }
    async rotateToken(tokenId, orgId, rotatedBy) {
        return withTransaction(async (client) => {
            const existing = await repository.findScimTokenById(tokenId, client);
            if (!existing) {
                throw new Error('Token not found');
            }
            if (existing.org_id !== orgId) {
                throw new Error('Token does not belong to this organization');
            }
            if (existing.revoked_at) {
                throw new Error('Token already revoked');
            }
            const scopes = await repository.listScimTokenScopes(tokenId, client);
            const allowedIps = await repository.listScimTokenIps(tokenId, client);
            const created = await this.createTokenInTransaction({
                orgId: existing.org_id,
                createdBy: rotatedBy,
                scopes,
                allowedIps,
            }, client);
            const gracePeriodEndsAt = new Date(Date.now() + env.SCIM_TOKEN_GRACE_PERIOD_MINUTES * 60000);
            await repository.rotateScimToken(tokenId, created.tokenId, gracePeriodEndsAt, client);
            logAudit({
                user_id: rotatedBy,
                org_id: orgId,
                actor_type: 'admin',
                actor_id: rotatedBy,
                action: 'scim_token.rotated',
                resource_type: 'scim_token',
                resource_id: tokenId,
                ip_address: '0.0.0.0',
                request_id: 'scim-token-service',
                metadata: { new_token_id: created.tokenId },
            });
            return { rawToken: created.rawToken, newTokenId: created.tokenId };
        });
    }
    async revokeToken(tokenId, orgId, revokedBy) {
        const existing = await repository.findScimTokenById(tokenId);
        if (!existing) {
            throw new Error('Token not found');
        }
        if (existing.org_id !== orgId) {
            throw new Error('Token does not belong to this organization');
        }
        await repository.revokeScimToken(tokenId);
        logAudit({
            user_id: revokedBy,
            org_id: orgId,
            actor_type: 'admin',
            actor_id: revokedBy,
            action: 'scim_token.revoked',
            resource_type: 'scim_token',
            resource_id: tokenId,
            ip_address: '0.0.0.0',
            request_id: 'scim-token-service',
        });
    }
    async listTokens(orgId) {
        return repository.listScimTokensForOrg(orgId);
    }
    async createTokenInTransaction(input, client) {
        const rawToken = `scim_${randomBytes(32).toString('hex')}`;
        const tokenHash = hashScimToken(rawToken);
        const expiresAt = new Date(Date.now() + (input.expiresInDays ?? env.SCIM_DEFAULT_TOKEN_EXPIRY_DAYS) * 86400000);
        const created = await repository.createScimToken({
            orgId: input.orgId,
            tokenHash,
            createdBy: input.createdBy,
            expiresAt,
        }, client);
        await repository.insertScimTokenScopes(created.id, input.scopes, client);
        await repository.insertScimTokenIps(created.id, input.allowedIps ?? [], client);
        logAudit({
            user_id: input.createdBy,
            org_id: input.orgId,
            actor_type: 'admin',
            actor_id: input.createdBy,
            action: 'scim_token.created',
            resource_type: 'scim_token',
            resource_id: created.id,
            ip_address: '0.0.0.0',
            request_id: 'scim-token-service',
            metadata: { scopes: input.scopes, ip_count: input.allowedIps?.length ?? 0 },
        });
        tokenLogger.info({ tokenId: created.id, orgId: input.orgId }, 'SCIM token created');
        return { rawToken, tokenId: created.id };
    }
}
//# sourceMappingURL=scim-token.service.js.map